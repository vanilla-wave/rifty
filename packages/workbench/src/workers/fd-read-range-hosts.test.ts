/**
 * ADR-0576 on the Workbench and SDK stacks: a positional read leaves every
 * `FsSync` layer and the sync-RPC reply with its range only, and the owner
 * wrappers copy the range, never the whole file.
 */
import { SyncRpcFsSync, installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createGuestLayout } from './guest-layout.ts';
import { createInstallClaimFs } from './install-claim-fs.ts';
import { createNoCoiProjectFs } from './no-coi-project-fs.ts';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';

interface Meter {
  bytes: number;
  calls: number;
}

/** Real `FsSync` whose returned range bytes are counted per layer. */
function metered(inner: FsSync, meter: Meter): FsSync {
  return new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result instanceof Uint8Array) {
          meter.bytes += result.byteLength;
          meter.calls++;
        }
        return result;
      };
    },
  });
}

/** Guest `SyncRpcFsSync` over the real owner handlers + binary decoders; replies counted. */
function guestOver(getVfs: () => FsSync, reply: Meter): SyncRpcFsSync {
  const registry = new Map<
    string,
    { handler: (p: unknown) => unknown; decode?: (p: Uint8Array) => unknown }
  >();
  installRuntimeJsFsHandlers(
    {
      register: (
        method: string,
        handler: (p: unknown) => unknown,
        options?: { decodeBinaryRequest?: (p: Uint8Array) => unknown },
      ) => registry.set(method, { handler, decode: options?.decodeBinaryRequest }),
    } as never,
    getVfs,
  );
  const handle = (method: string, payload: unknown, binary: boolean): unknown => {
    const entry = registry.get(method);
    if (entry === undefined) throw new Error(`missing handler: ${method}`);
    const value = entry.handler(
      binary && entry.decode ? entry.decode(payload as Uint8Array) : payload,
    );
    if (value instanceof Uint8Array) {
      reply.bytes += value.byteLength;
      reply.calls++;
    }
    return value;
  };
  return new SyncRpcFsSync(
    (method, payload) => handle(method, payload, false),
    (method, payload) => handle(method, payload, true),
  );
}

const CALL = 64 * 1024;
const pattern = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, i) => (i * 29) % 251);

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);

/** Read `path` in `CALL`-sized positional reads; returns the bytes. */
function readInCalls(fs: FsSync, path: string): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let position = 0; ; position += CALL) {
    const got = fs.readFileRangeSync(path, position, CALL);
    if (got.byteLength === 0) break;
    parts.push(got.slice());
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

describe('Workbench: guest → owner RPC → ProjectTerminalFsSync → OwnerVfsAuthority → store', () => {
  it('every layer and the reply move ≤ ×1.1 the file; doubling the file keeps the per-call bytes', () => {
    const perCall: number[] = [];
    for (const size of [1 << 20, 2 << 20]) {
      const store = new MemoryFsSync();
      store.mkdirSync('/scratch', { recursive: true });
      store.writeFileSync('/scratch/big.bin', pattern(size));
      const storeOut: Meter = { bytes: 0, calls: 0 };
      const authorityOut: Meter = { bytes: 0, calls: 0 };
      const reply: Meter = { bytes: 0, calls: 0 };
      const authority = metered(createOwnerVfsAuthority(metered(store, storeOut)), authorityOut);
      const view = new ProjectTerminalFsSync(
        authority,
        createGuestLayout('/home/project', '/scratch'),
      );
      const guest = guestOver(() => view, reply);

      expect(same(readInCalls(guest, '/home/project/big.bin'), pattern(size))).toBe(true);
      for (const meter of [storeOut, authorityOut, reply]) {
        expect(meter.bytes).toBeLessThanOrEqual(size * 1.1);
        expect(meter.bytes / meter.calls).toBeLessThanOrEqual(CALL);
      }
      perCall.push(reply.bytes / reply.calls);
    }
    expect((perCall[1] ?? 0) / (perCall[0] ?? 1)).toBeLessThanOrEqual(1.1);
  });

  it('the authority hands out a copy of the range, not a view of its store', () => {
    const store = new MemoryFsSync();
    store.writeFileSync('/a.bin', new Uint8Array([1, 2, 3, 4]));
    const authority = createOwnerVfsAuthority(store);
    const got = authority.readFileRangeSync('/a.bin', 1, 2);
    got[0] = 99;
    expect(Array.from(store.readFileBytesSync('/a.bin'))).toEqual([1, 2, 3, 4]);
    expect(got.buffer.byteLength).toBe(2);
  });
});

describe('SDK: NoCoiProjectFs → InstallClaimFs → store (in-realm node)', () => {
  it('each wrapper copies only the range', () => {
    const size = 2 << 20;
    const store = new MemoryFsSync();
    store.mkdirSync('/p', { recursive: true });
    store.writeFileSync('/p/big.bin', pattern(size));
    const storeOut: Meter = { bytes: 0, calls: 0 };
    const claimOut: Meter = { bytes: 0, calls: 0 };
    const projectOut: Meter = { bytes: 0, calls: 0 };
    const claim = metered(createInstallClaimFs(metered(store, storeOut)).fs, claimOut);
    const project = metered(createNoCoiProjectFs(claim).fs, projectOut);

    expect(same(readInCalls(project, '/p/big.bin'), pattern(size))).toBe(true);
    for (const meter of [storeOut, claimOut, projectOut]) {
      expect(meter.bytes).toBeLessThanOrEqual(size * 1.1);
    }
    const one = project.readFileRangeSync('/p/big.bin', 10, 5);
    expect(one.buffer.byteLength).toBe(5);
  });
});
