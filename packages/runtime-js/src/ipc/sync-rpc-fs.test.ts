import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { SyncRpcFsSync } from './sync-rpc-fs.ts';

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
    expect(got.length).toBe(big.length);
    expect(got[0]).toBe(big[0]);
    expect(got[got.length - 1]).toBe(big[big.length - 1]);
  });

  it('statSyncOrNull returns null on a miss', () => {
    const remote = new SyncRpcFsSync(loopback(new MemoryFsSync()));
    expect(remote.statSyncOrNull('/nope')).toBeNull();
  });
});
