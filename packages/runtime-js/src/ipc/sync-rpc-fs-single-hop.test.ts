import { execFileSync } from 'node:child_process';
import { VfsError } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { createTestSyncRpcFs } from './sync-rpc-fs-test-api.ts';

interface CallRecord {
  method: string;
  payload: unknown;
}

function handlersOf(vfs: MemoryFsSync) {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  installRuntimeJsFsHandlers(
    {
      register: (method: string, handler: (payload: unknown) => unknown) =>
        handlers.set(method, handler),
    } as never,
    () => vfs,
  );
  return handlers;
}

function loopback(
  handlers: ReadonlyMap<string, (payload: unknown) => unknown>,
  calls: CallRecord[],
) {
  return (method: string, payload: unknown): unknown => {
    calls.push({ method, payload });
    const handler = handlers.get(method);
    if (handler === undefined) throw new Error(`missing owner handler: ${method}`);
    return handler(payload);
  };
}

function expectedReadHead(bytes: Uint8Array): Uint8Array {
  const first = bytes.subarray(0, FS_RPC_CHUNK);
  const reply = new Uint8Array(8 + first.length);
  new DataView(reply.buffer).setFloat64(0, bytes.length, true);
  reply.set(first, 8);
  return reply;
}

function caught(read: () => unknown): VfsError {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(VfsError);
    return error as VfsError;
  }
  throw new Error('expected VfsError');
}

describe('ADR-0365 single-hop owner-backed reads', () => {
  it('uses one head request through the chunk boundary and only continues after its first bytes', () => {
    const owner = new MemoryFsSync();
    const ownerRead = vi.spyOn(owner, 'readFileBytesSync');
    const ownerExists = vi.spyOn(owner, 'existsSync');
    const ownerReaddir = vi.spyOn(owner, 'readdirSync');
    const ownerStat = vi.spyOn(owner, 'statSync');
    const ownerStatOrNull = vi.spyOn(owner, 'statSyncOrNull');
    const calls: CallRecord[] = [];
    const handlers = handlersOf(owner);
    const remote = createTestSyncRpcFs(loopback(handlers, calls));
    const sizes = [0, 1, FS_RPC_CHUNK, FS_RPC_CHUNK + 1];

    for (const size of sizes) {
      const path = `/size-${size}.bin`;
      const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
      owner.writeFileSync(path, bytes);
      calls.length = 0;
      const headReadsBefore = ownerRead.mock.calls.length;
      const headProbesBefore =
        ownerExists.mock.calls.length +
        ownerReaddir.mock.calls.length +
        ownerStat.mock.calls.length +
        ownerStatOrNull.mock.calls.length;
      const readHead = handlers.get('fs.readFileHead');
      expect(readHead).toBeDefined();
      expect(readHead?.({ path })).toEqual(expectedReadHead(bytes));
      expect(ownerRead.mock.calls.length - headReadsBefore).toBe(1);
      expect(
        ownerExists.mock.calls.length +
          ownerReaddir.mock.calls.length +
          ownerStat.mock.calls.length +
          ownerStatOrNull.mock.calls.length -
          headProbesBefore,
      ).toBe(0);
      const readsBefore = ownerRead.mock.calls.length;
      const probesBefore =
        ownerExists.mock.calls.length +
        ownerReaddir.mock.calls.length +
        ownerStat.mock.calls.length +
        ownerStatOrNull.mock.calls.length;

      expect(remote.readFileBytesSync(path)).toEqual(bytes);
      expect(ownerRead.mock.calls.length - readsBefore).toBe(size > FS_RPC_CHUNK ? 2 : 1);
      expect(
        ownerExists.mock.calls.length +
          ownerReaddir.mock.calls.length +
          ownerStat.mock.calls.length +
          ownerStatOrNull.mock.calls.length -
          probesBefore,
      ).toBe(0);
      expect(calls).toEqual(
        size > FS_RPC_CHUNK
          ? [
              { method: 'fs.readFileHead', payload: { path } },
              {
                method: 'fs.readChunk',
                payload: { path, offset: FS_RPC_CHUNK, length: 1 },
              },
            ]
          : [{ method: 'fs.readFileHead', payload: { path } }],
      );
    }
  });

  it('observes owner overwrites and preserves the owner error identity in the first request', () => {
    const owner = new MemoryFsSync();
    owner.mkdirSync('/dir', { recursive: true });
    owner.writeFileSync('/plain.txt', new TextEncoder().encode('old'));
    const calls: CallRecord[] = [];
    const remote = createTestSyncRpcFs(loopback(handlersOf(owner), calls));
    const ownerRead = vi.spyOn(owner, 'readFileBytesSync');
    const ownerExists = vi.spyOn(owner, 'existsSync');
    const ownerReaddir = vi.spyOn(owner, 'readdirSync');
    const ownerStat = vi.spyOn(owner, 'statSync');
    const ownerStatOrNull = vi.spyOn(owner, 'statSyncOrNull');

    expect(new TextDecoder().decode(remote.readFileBytesSync('/plain.txt'))).toBe('old');
    owner.writeFileSync('/plain.txt', new TextEncoder().encode('new bytes'));
    expect(new TextDecoder().decode(remote.readFileBytesSync('/plain.txt'))).toBe('new bytes');
    expect(calls.splice(0)).toEqual([
      { method: 'fs.readFileHead', payload: { path: '/plain.txt' } },
      { method: 'fs.readFileHead', payload: { path: '/plain.txt' } },
    ]);

    for (const path of ['/missing.txt', '/dir', '/plain.txt/child']) {
      const ownerError = caught(() => owner.readFileBytesSync(path));
      const readsBeforeRemote = ownerRead.mock.calls.length;
      const remoteError = caught(() => remote.readFileBytesSync(path));
      expect({ name: remoteError.name, code: remoteError.code, path: remoteError.path }).toEqual({
        name: ownerError.name,
        code: ownerError.code,
        path: ownerError.path,
      });
      expect(ownerRead.mock.calls.length - readsBeforeRemote).toBe(1);
      expect(calls.splice(0)).toEqual([{ method: 'fs.readFileHead', payload: { path } }]);
    }
    expect(ownerExists).not.toHaveBeenCalled();
    expect(ownerReaddir).not.toHaveBeenCalled();
    expect(ownerStat).not.toHaveBeenCalled();
    expect(ownerStatOrNull).not.toHaveBeenCalled();
  });

  it('pins the Node 24 byte lengths and read error codes used by the remote parity case', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs');const os=require('node:os');const p=require('node:path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'rifty-read-'));try{fs.writeFileSync(p.join(d,'zero'),Buffer.alloc(0));fs.writeFileSync(p.join(d,'one'),Buffer.from([165]));fs.writeFileSync(p.join(d,'chunk'),Buffer.alloc(262144,7));fs.writeFileSync(p.join(d,'large'),Buffer.alloc(262145,9));const code=x=>{try{fs.readFileSync(x);return 'OK'}catch(e){return e.code}};console.log(JSON.stringify({zero:fs.readFileSync(p.join(d,'zero')).length,one:[...fs.readFileSync(p.join(d,'one'))],chunk:fs.readFileSync(p.join(d,'chunk')).length,large:fs.readFileSync(p.join(d,'large')).length,missing:code(p.join(d,'missing')),dir:code(d)}))}finally{fs.rmSync(d,{recursive:true,force:true})}`,
      ],
      { encoding: 'utf8' },
    );
    expect(process.version).toMatch(/^v24\./);
    expect(JSON.parse(output)).toEqual({
      zero: 0,
      one: [165],
      chunk: 262144,
      large: 262145,
      missing: 'ENOENT',
      dir: 'EISDIR',
    });
  });
});
