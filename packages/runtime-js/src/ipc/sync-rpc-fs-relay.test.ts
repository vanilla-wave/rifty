import type { FsSync } from '@riftydev/vfs';
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

function handlersOf(getVfs: () => FsSync) {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  installRuntimeJsFsHandlers(
    {
      register: (method: string, handler: (payload: unknown) => unknown) =>
        handlers.set(method, handler),
    } as never,
    getVfs,
  );
  return handlers;
}

function loopback(
  handlers: ReadonlyMap<string, (payload: unknown) => unknown>,
  calls: CallRecord[],
  before?: (method: string) => void,
) {
  return (method: string, payload: unknown): unknown => {
    calls.push({ method, payload });
    before?.(method);
    const handler = handlers.get(method);
    if (handler === undefined) throw new Error(`missing handler: ${method}`);
    return handler(payload);
  };
}

const PATH = '/node_modules/esbuild-wasm/esbuild.wasm';

/** The one ADR-0365 request sequence a cold read of `size` bytes issues. */
function readSequence(size: number): CallRecord[] {
  const calls: CallRecord[] = [{ method: 'fs.readFileHead', payload: { path: PATH } }];
  for (let offset = FS_RPC_CHUNK; offset < size; offset += FS_RPC_CHUNK)
    calls.push({
      method: 'fs.readChunk',
      payload: { path: PATH, offset, length: Math.min(FS_RPC_CHUNK, size - offset) },
    });
  return calls;
}

/** Owner store → nested-Worker relay (its own SyncRpcFsSync) → grandchild. */
function chain(owner: MemoryFsSync, before?: (method: string) => void) {
  const ownerCalls: CallRecord[] = [];
  const relay = createTestSyncRpcFs(
    loopback(
      handlersOf(() => owner),
      ownerCalls,
      before,
    ),
  );
  const relayCalls: CallRecord[] = [];
  const grandchild = createTestSyncRpcFs(
    loopback(
      handlersOf(() => relay),
      relayCalls,
    ),
  );
  return { ownerCalls, relayCalls, grandchild };
}

describe('nested sync-RPC relay forwards ADR-0365 reads', () => {
  it('a grandchild multi-chunk read costs exactly one owner request per relayed request', () => {
    const owner = new MemoryFsSync();
    const size = 5 * FS_RPC_CHUNK + 7;
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31) % 251);
    owner.mkdirSync('/node_modules/esbuild-wasm', { recursive: true });
    owner.writeFileSync(PATH, bytes);
    const { ownerCalls, relayCalls, grandchild } = chain(owner);
    const ownerRead = vi.spyOn(owner, 'readFileBytesSync');

    expect(grandchild.readFileBytesSync(PATH)).toEqual(bytes);
    expect(relayCalls).toEqual(readSequence(size));
    // Before: every relayed request re-read the whole file upstream (6 × 6 requests).
    expect(ownerCalls).toEqual(readSequence(size));
    expect(ownerRead).toHaveBeenCalledTimes(readSequence(size).length);
  });

  it('keeps single-chunk files at one request per hop', () => {
    const owner = new MemoryFsSync();
    owner.mkdirSync('/node_modules/esbuild-wasm', { recursive: true });
    owner.writeFileSync(PATH, new TextEncoder().encode('small'));
    const { ownerCalls, relayCalls, grandchild } = chain(owner);

    expect(new TextDecoder().decode(grandchild.readFileBytesSync(PATH))).toBe('small');
    expect(relayCalls).toEqual(readSequence(5));
    expect(ownerCalls).toEqual(readSequence(5));
  });

  it('an owner shrink between head and continuation still fails loud at the grandchild', () => {
    const owner = new MemoryFsSync();
    owner.mkdirSync('/node_modules/esbuild-wasm', { recursive: true });
    owner.writeFileSync(PATH, new Uint8Array(2 * FS_RPC_CHUNK + 1));
    const { grandchild } = chain(owner, (method) => {
      if (method === 'fs.readChunk') owner.writeFileSync(PATH, new Uint8Array(3));
    });

    expect(() => grandchild.readFileBytesSync(PATH)).toThrow(
      /short read .* got 262144 of 524289 bytes/u,
    );
  });

  it('preserves the owner error identity across the relay', () => {
    const owner = new MemoryFsSync();
    owner.mkdirSync('/dir', { recursive: true });
    const { grandchild } = chain(owner);

    for (const [path, code] of [
      ['/missing.wasm', 'ENOENT'],
      ['/dir', 'EISDIR'],
    ] as const) {
      let caught: unknown;
      try {
        grandchild.readFileBytesSync(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(VfsError);
      expect((caught as VfsError).code).toBe(code);
    }
  });
});
