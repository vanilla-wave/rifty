import { FS_RPC_CHUNK, SyncRpcFsSync, installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
import { VfsError } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createGuestLayout } from './guest-layout.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';

type Handler = (payload: unknown) => unknown;
interface Registration {
  readonly handler: Handler;
  readonly decode?: (payload: Uint8Array) => unknown;
}

/** One dispatcher hop with the real handlers and their real binary decoders. */
function hop(getVfs: () => FsSync, log: string[]): SyncRpcFsSync {
  const registry = new Map<string, Registration>();
  installRuntimeJsFsHandlers(
    {
      register: (
        method: string,
        handler: Handler,
        options?: { decodeBinaryRequest?: (payload: Uint8Array) => unknown },
      ) => registry.set(method, { handler, decode: options?.decodeBinaryRequest }),
    } as never,
    getVfs,
  );
  const handle = (method: string, payload: unknown, binary: boolean): unknown => {
    const entry = registry.get(method);
    if (entry === undefined) throw new Error(`missing handler: ${method}`);
    const request = binary && entry.decode ? entry.decode(payload as Uint8Array) : payload;
    log.push(`${method} ${JSON.stringify(request)}`);
    return entry.handler(request);
  };
  return new SyncRpcFsSync(
    (method, payload) => handle(method, payload, false),
    (method, payload) => handle(method, payload, true),
  );
}

const OWNER_ROOT = '/scratch';
const OWNER_PATH = `${OWNER_ROOT}/node_modules/esbuild-wasm/esbuild.wasm`;
const GUEST_PATH = '/home/project/node_modules/esbuild-wasm/esbuild.wasm';

/** Owner store → dev-server child relay serving its rooted guest view → nested Worker. */
function rootedChain(owner: MemoryFsSync) {
  const ownerLog: string[] = [];
  const relay = hop(() => owner, ownerLog);
  const guestView = new ProjectTerminalFsSync(
    relay,
    createGuestLayout('/home/project', OWNER_ROOT),
  );
  const nested = hop(() => guestView, []);
  return { ownerLog, nested };
}

describe('rooted relay forwards ADR-0365 reads through guest resolution', () => {
  it('maps the guest path once and issues one owner request per nested request', () => {
    const owner = new MemoryFsSync();
    const size = 3 * FS_RPC_CHUNK + 11;
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 7) % 253);
    owner.mkdirSync(`${OWNER_ROOT}/node_modules/esbuild-wasm`, { recursive: true });
    owner.writeFileSync(OWNER_PATH, bytes);
    const { ownerLog, nested } = rootedChain(owner);

    expect(nested.readFileBytesSync(GUEST_PATH)).toEqual(bytes);
    // Before: each of the 4 nested requests re-read the whole file upstream (16 requests).
    expect(ownerLog).toEqual([
      `fs.readFileHead ${JSON.stringify({ path: OWNER_PATH })}`,
      ...[1, 2, 3].map(
        (index) =>
          `fs.readChunk ${JSON.stringify({
            path: OWNER_PATH,
            offset: index * FS_RPC_CHUNK,
            length: index === 3 ? 11 : FS_RPC_CHUNK,
          })}`,
      ),
    ]);
  });

  it('keeps guest error identity: absent ENOENT, virtual ancestor EISDIR', () => {
    const owner = new MemoryFsSync();
    owner.mkdirSync(OWNER_ROOT, { recursive: true });
    const { ownerLog, nested } = rootedChain(owner);

    for (const [path, code] of [
      ['/home/project/missing.wasm', 'ENOENT'],
      ['/home', 'EISDIR'],
    ] as const) {
      let caught: unknown;
      try {
        nested.readFileBytesSync(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(VfsError);
      expect((caught as VfsError).code).toBe(code);
      expect((caught as VfsError).path).toBe(path);
    }
    expect(ownerLog.every((line) => !line.includes('/home'))).toBe(true);
  });
});
