import { VfsError } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror, syncMirror } from '../builtins/fs-sync-mirror.ts';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { SyncRpcFsSync, installRemoteSyncFs } from './sync-rpc-fs.ts';

/** Synchronous loopback: route client `call(method,payload)` to the owner handlers. */
function loopback(vfs: MemoryFsSync): (m: string, p: unknown) => unknown {
  const table = new Map<string, (p: unknown) => unknown>();
  installRuntimeJsFsHandlers(
    { register: (m: string, h: (p: unknown) => unknown) => table.set(m, h) } as never,
    () => vfs,
  );
  return (method, payload) => {
    const h = table.get(method);
    if (!h) throw new Error(`no handler: ${method}`);
    return h(payload); // handlers here are sync (fixture VFS) → direct value
  };
}

describe('installRemoteSyncFs', () => {
  afterEach(() => {
    // prevent global-mirror swap from leaking into sibling tests
    resetSyncMirror();
  });

  it('installs the remote VFS as the realm sync mirror', () => {
    const ownerStore = new MemoryFsSync();
    const call = loopback(ownerStore);
    const remote = installRemoteSyncFs(call);

    // confirm the returned instance is a SyncRpcFsSync
    expect(remote).toBeInstanceOf(SyncRpcFsSync);

    // write via syncMirror() → should land in the owner store
    syncMirror().writeFileSync('/g.txt', new TextEncoder().encode('global'));
    expect(new TextDecoder().decode(syncMirror().readFileBytesSync('/g.txt'))).toBe('global');
    // confirm it actually landed in the fixture (round-trip through the owner)
    expect(new TextDecoder().decode(ownerStore.readFileBytesSync('/g.txt'))).toBe('global');
  });
});

describe('SyncRpcFsSync', () => {
  it('reads back a small file written through it', () => {
    const vfs = new MemoryFsSync();
    const remote = new SyncRpcFsSync(loopback(vfs));
    remote.writeFileSync('/a.txt', new TextEncoder().encode('hello'));
    expect(remote.existsSync('/a.txt')).toBe(true);
    expect(new TextDecoder().decode(remote.readFileBytesSync('/a.txt'))).toBe('hello');
    // landed in the owner store:
    expect(new TextDecoder().decode(vfs.readFileBytesSync('/a.txt'))).toBe('hello');
  });

  it('chunks a file larger than one ring frame', () => {
    const vfs = new MemoryFsSync();
    const remote = new SyncRpcFsSync(loopback(vfs));
    const big = new Uint8Array(FS_RPC_CHUNK * 2 + 123).map((_, i) => i % 251);
    remote.writeFileSync('/big.bin', big);
    const got = remote.readFileBytesSync('/big.bin');
    expect(got).toEqual(big);
  });

  it('statSyncOrNull returns null on a miss', () => {
    const remote = new SyncRpcFsSync(loopback(new MemoryFsSync()));
    expect(remote.statSyncOrNull('/nope')).toBeNull();
  });

  it('throws on a short read instead of silently returning a truncated buffer (ADR-0150 never-silent-truncate)', () => {
    // The owner returns an empty chunk mid-read (file shrank below the offset
    // after the stat snapshot) — the child MUST fail loudly, not hand the caller
    // a partial file presented as the whole thing.
    const N = FS_RPC_CHUNK + 100; // forces a second readChunk call
    let chunkCalls = 0;
    const fakeCall = (method: string, _payload: unknown): unknown => {
      if (method === 'fs.statOrNull') return { isFile: true, isDirectory: false, size: N };
      if (method === 'fs.readChunk') {
        chunkCalls += 1;
        // First chunk full; second chunk empty (concurrent shrink) → short read.
        return chunkCalls === 1 ? new Uint8Array(FS_RPC_CHUNK).fill(0xcd) : new Uint8Array(0);
      }
      throw new Error(`unexpected: ${method}`);
    };
    const remote = new SyncRpcFsSync(fakeCall);
    expect(() => remote.readFileBytesSync('/f.bin')).toThrow(/short read/i);
  });

  it('readFileBytesSync does not throw when readChunk returns more bytes than originally stat-d size (concurrent grow)', () => {
    // Regression: if a concurrent writer grows the file between statOrNull and a
    // readChunk call the owner may return a chunk larger than `size - offset`,
    // which caused `out.set(chunk, offset)` to throw RangeError (child CLI reading
    // owner fs over sync-RPC, ADR-0150).
    const N = 10;
    const extra = 5; // owner returns N+extra bytes on the first chunk call
    const fakeCall = (method: string, _payload: unknown): unknown => {
      if (method === 'fs.statOrNull') return { isFile: true, isDirectory: false, size: N };
      if (method === 'fs.readChunk') {
        // Return more bytes than N to simulate the concurrent-grow race.
        return new Uint8Array(N + extra).fill(0xab);
      }
      throw new Error(`unexpected: ${method}`);
    };
    const remote = new SyncRpcFsSync(fakeCall);
    let result: Uint8Array | undefined;
    expect(() => {
      result = remote.readFileBytesSync('/f.bin');
    }).not.toThrow();
    // Must return exactly N bytes (the originally stat'd snapshot size).
    expect(result!.length).toBe(N);
  });

  it('statSync round-trips over loopback — returns correct stat for a file and a dir', () => {
    // RED: fs.stat handler is async → over sync loopback call returns a Promise,
    // not FsStatShape. This test FAILS pre-fix.
    const vfs = new MemoryFsSync();
    vfs.writeFileSync('/hello.txt', new TextEncoder().encode('world'));
    vfs.mkdirSync('/mydir', { recursive: false });
    const remote = new SyncRpcFsSync(loopback(vfs));
    const fileStat = remote.statSync('/hello.txt');
    expect(fileStat.isFile).toBe(true);
    expect(fileStat.isDirectory).toBe(false);
    expect(fileStat.size).toBe(5);
    const dirStat = remote.statSync('/mydir');
    expect(dirStat.isFile).toBe(false);
    expect(dirStat.isDirectory).toBe(true);
  });

  it('readFileBytesSync on a missing path throws VfsError with code ENOENT (matches MemoryFsSync shape)', () => {
    // RED: current impl throws a hand-rolled Error{code:'ENOENT'}, not VfsError.
    // This test FAILS pre-fix because instanceof VfsError is false.
    const vfs = new MemoryFsSync();
    const remote = new SyncRpcFsSync(loopback(vfs));
    let remoteErr: unknown;
    let backendErr: unknown;
    try {
      remote.readFileBytesSync('/no-such-file.txt');
    } catch (e) {
      remoteErr = e;
    }
    try {
      vfs.readFileBytesSync('/no-such-file.txt');
    } catch (e) {
      backendErr = e;
    }
    expect(remoteErr).toBeInstanceOf(VfsError);
    expect(backendErr).toBeInstanceOf(VfsError);
    expect((remoteErr as VfsError).code).toBe('ENOENT');
    expect((remoteErr as VfsError).name).toBe((backendErr as VfsError).name);
    expect((remoteErr as VfsError).code).toBe((backendErr as VfsError).code);
  });
});
