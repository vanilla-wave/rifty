import {
  SabRing,
  SyncRpcDispatcher,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '@riftydev/kernel';
import type { VfsMutationGuard, VfsMutationIntent } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_METHODS, FS_RPC_CHUNK, bytesToBase64 } from './fs-rpc-protocol.ts';

/** Collect registered handlers into a map by driving a fake dispatcher. */
function handlersOf(vfs: MemoryFsSync, guard?: VfsMutationGuard) {
  const table = new Map<string, (p: unknown) => unknown | Promise<unknown>>();
  installRuntimeJsFsHandlers(
    { register: (m: string, h: (p: unknown) => unknown) => table.set(m, h) } as never,
    () => vfs,
    guard,
  );
  return table;
}

describe('installRuntimeJsFsHandlers', () => {
  it('serves stat/exists/write/read round-trip', async () => {
    const vfs = new MemoryFsSync();
    const t = handlersOf(vfs);
    const write = t.get(FS_METHODS.writeChunk)!({
      path: '/a.txt',
      b64: bytesToBase64(new TextEncoder().encode('hi')),
      offset: 0,
      truncate: true,
    });
    expect(write).toBeNull();
    expect(await t.get(FS_METHODS.exists)!({ path: '/a.txt' })).toBe(true);
    expect(((await t.get(FS_METHODS.stat)!({ path: '/a.txt' })) as { size?: number }).size).toBe(2);
    const bytes = (await t.get(FS_METHODS.readChunk)!({
      path: '/a.txt',
      offset: 0,
      length: FS_RPC_CHUNK,
    })) as Uint8Array;
    expect(new TextDecoder().decode(bytes)).toBe('hi');
  });

  it('readChunk returns a ranged slice and empty at EOF', async () => {
    const vfs = new MemoryFsSync();
    const big = new Uint8Array(FS_RPC_CHUNK + 10).fill(7);
    await handlersOf(vfs).get(FS_METHODS.writeChunk)!({
      path: '/b.bin',
      b64: bytesToBase64(big),
      offset: 0,
      truncate: true,
    });
    const t = handlersOf(vfs);
    const c0 = (await t.get(FS_METHODS.readChunk)!({
      path: '/b.bin',
      offset: 0,
      length: FS_RPC_CHUNK,
    })) as Uint8Array;
    const c1 = (await t.get(FS_METHODS.readChunk)!({
      path: '/b.bin',
      offset: FS_RPC_CHUNK,
      length: FS_RPC_CHUNK,
    })) as Uint8Array;
    const cEnd = (await t.get(FS_METHODS.readChunk)!({
      path: '/b.bin',
      offset: FS_RPC_CHUNK + 10,
      length: FS_RPC_CHUNK,
    })) as Uint8Array;
    expect(c0.length).toBe(FS_RPC_CHUNK);
    expect(c1.length).toBe(10);
    expect(cEnd.length).toBe(0);
  });

  it('propagates ENOENT with code', async () => {
    const t = handlersOf(new MemoryFsSync());
    // stat handler is sync — throws directly (not a rejected Promise)
    expect(() => t.get(FS_METHODS.stat)!({ path: '/missing' })).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
    expect(await t.get(FS_METHODS.statOrNull)!({ path: '/missing' })).toBeNull();
  });

  it('describes every byte/tree mutation once without copying handler behavior', () => {
    const vfs = new MemoryFsSync();
    vfs.writeFileSync('/remove.txt', new Uint8Array([1]));
    vfs.writeFileSync('/rename.txt', new Uint8Array([2]));
    vfs.writeFileSync('/copy.txt', new Uint8Array([3]));
    vfs.mkdirSync('/copy-tree', { recursive: true });
    vfs.writeFileSync('/copy-tree/a.txt', new Uint8Array([4]));
    const mutations: VfsMutationIntent[] = [];
    const handlers = handlersOf(vfs, (intents, apply) => {
      mutations.push(...intents);
      return apply();
    });

    expect(
      handlers.get(FS_METHODS.writeChunk)!({
        path: '/written.txt',
        b64: bytesToBase64(new Uint8Array([5])),
        offset: 0,
        truncate: true,
      }),
    ).toBeNull();
    expect(handlers.get(FS_METHODS.mkdir)!({ path: '/made', recursive: false })).toBeNull();
    expect(
      handlers.get(FS_METHODS.rm)!({ path: '/remove.txt', recursive: false, force: false }),
    ).toBeNull();
    expect(
      handlers.get(FS_METHODS.rename)!({ src: '/rename.txt', dst: '/renamed.txt' }),
    ).toBeNull();
    expect(handlers.get(FS_METHODS.copyFile)!({ src: '/copy.txt', dst: '/copied.txt' })).toBeNull();
    expect(
      handlers.get(FS_METHODS.cp)!({ src: '/copy-tree', dst: '/copied-tree', recursive: true }),
    ).toBeNull();
    expect(
      handlers.get(FS_METHODS.utimes)!({ path: '/written.txt', atimeMs: 1, mtimeMs: 2 }),
    ).toBeNull();

    expect(mutations).toEqual([
      { kind: 'write', path: '/written.txt' },
      { kind: 'mkdir', path: '/made' },
      { kind: 'rm', path: '/remove.txt' },
      { kind: 'rename', sourcePath: '/rename.txt', targetPath: '/renamed.txt' },
      { kind: 'copy', sourcePath: '/copy.txt', targetPath: '/copied.txt' },
      { kind: 'copy', sourcePath: '/copy-tree', targetPath: '/copied-tree' },
      { kind: 'utimes', path: '/written.txt' },
    ]);
  });

  it('holds a real dispatcher reply until an async mutation guard applies', async () => {
    const vfs = new MemoryFsSync();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    installRuntimeJsFsHandlers(
      dispatcher,
      () => vfs,
      async (intents, apply) => {
        expect(intents).toEqual([{ kind: 'write', path: '/guarded.txt' }]);
        await gate;
        return apply();
      },
    );
    const { sab, ring } = createSabRing({ payloadCapacity: 512 });
    const caller = SabRing.attach(sab, 512);
    caller.writeRequest(
      encodeRequest({
        method: FS_METHODS.writeChunk,
        payload: {
          path: '/guarded.txt',
          b64: bytesToBase64(new Uint8Array([7])),
          offset: 0,
          truncate: true,
        },
      }),
    );

    dispatcher.pumpOnce(ring);
    await Promise.resolve();
    expect(vfs.existsSync('/guarded.txt')).toBe(false);

    release();
    expect(decodeReply(await caller.waitReplyAsync(5_000))).toEqual({ ok: true, value: null });
    expect(vfs.readFileBytesSync('/guarded.txt')).toEqual(new Uint8Array([7]));
  });
});
