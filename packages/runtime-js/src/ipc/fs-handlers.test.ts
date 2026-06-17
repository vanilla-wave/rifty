import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_METHODS, FS_RPC_CHUNK, bytesToBase64 } from './fs-rpc-protocol.ts';

/** Collect registered handlers into a map by driving a fake dispatcher. */
function handlersOf(vfs: MemoryFsSync) {
  const table = new Map<string, (p: unknown) => unknown | Promise<unknown>>();
  installRuntimeJsFsHandlers(
    { register: (m: string, h: (p: unknown) => unknown) => table.set(m, h) } as never,
    () => vfs,
  );
  return table;
}

describe('installRuntimeJsFsHandlers', () => {
  it('serves stat/exists/write/read round-trip', async () => {
    const vfs = new MemoryFsSync();
    const t = handlersOf(vfs);
    await t.get(FS_METHODS.writeChunk)!({
      path: '/a.txt',
      b64: bytesToBase64(new TextEncoder().encode('hi')),
      offset: 0,
      truncate: true,
    });
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
});
