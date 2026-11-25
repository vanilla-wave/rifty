/**
 * ADR-0576: a positional fd read moves only its range out of `FsSync` and,
 * over sync-RPC, through the reply. Counter = bytes of every `Uint8Array` an
 * `FsSync` returns (or a reply carries), not copies or milliseconds.
 */
import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { installRuntimeJsFsHandlers } from '../ipc/fs-handlers.ts';
import { FS_RPC_CHUNK } from '../ipc/fs-rpc-protocol.ts';
import { createTestSyncRpcFs } from '../ipc/sync-rpc-fs-test-api.ts';
import { resetSyncMirror, setSyncMirror } from './fs-sync-mirror.ts';
import { closeSync, openSync, read, readSync } from './fs.ts';

const CALL = 64 * 1024;
const MiB = 1 << 20;

interface Meter {
  bytes: number;
}

/** Real `FsSync` whose every returned `Uint8Array` is counted. */
function metered(inner: FsSync, meter: Meter): FsSync {
  return new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result instanceof Uint8Array) meter.bytes += result.byteLength;
        return result;
      };
    },
  });
}

function handlersOf(getVfs: () => FsSync) {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  installRuntimeJsFsHandlers(
    { register: (method: string, h: (p: unknown) => unknown) => handlers.set(method, h) } as never,
    getVfs,
  );
  return handlers;
}

/** Child `SyncRpcFsSync` over owner handlers; every reply's bytes counted. */
function overRpc(owner: FsSync, reply: Meter): FsSync {
  const handlers = handlersOf(() => owner);
  return createTestSyncRpcFs((method, payload) => {
    const handler = handlers.get(method);
    if (handler === undefined) throw new Error(`missing handler ${method}`);
    const value = handler(payload);
    if (value instanceof Uint8Array) reply.bytes += value.byteLength;
    return value;
  });
}

const pattern = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, i) => (i * 13) % 251);

function ownerWith(bytes: Uint8Array): MemoryFsSync {
  const owner = new MemoryFsSync();
  owner.mkdirSync('/data', { recursive: true });
  owner.writeFileSync('/data/f.bin', bytes);
  return owner;
}

function readLoop(): { bytes: Uint8Array; calls: number } {
  const fd = openSync('/data/f.bin', 'r');
  const out: Uint8Array[] = [];
  const buffer = new Uint8Array(CALL);
  let calls = 0;
  for (;;) {
    calls++;
    const n = readSync(fd, buffer, 0, CALL, null);
    if (n === 0) break;
    out.push(buffer.slice(0, n));
  }
  closeSync(fd);
  return { bytes: Buffer.concat(out), calls };
}

type Host = (owner: FsSync, meter: Meter) => FsSync;

const hosts: ReadonlyArray<[string, Host]> = [
  ['in-process (FsSync out)', (owner, meter) => metered(owner, meter)],
  ['sync-RPC child (reply bytes)', (owner, meter) => overRpc(owner, meter)],
  [
    'sync-RPC relay grandchild (reply bytes at the owner)',
    (owner, meter) => overRpc(overRpc(owner, meter), { bytes: 0 }),
  ],
];

afterEach(() => resetSyncMirror());

describe.each(hosts)('readSync(fd) by range — %s', (_name, host) => {
  it('per call ≤ the requested length + a constant; doubling the file ≤ ×1.1; whole read ≤ ×1.1 size', () => {
    const perCall: number[] = [];
    for (const size of [1 * MiB, 2 * MiB]) {
      const bytes = pattern(size);
      const meter: Meter = { bytes: 0 };
      setSyncMirror(host(ownerWith(bytes), meter));
      const { bytes: got, calls } = readLoop();
      expect(got.byteLength).toBe(size);
      expect(Buffer.compare(Buffer.from(got), Buffer.from(bytes))).toBe(0);
      expect(meter.bytes).toBeLessThanOrEqual(size * 1.1);
      expect(meter.bytes / calls).toBeLessThanOrEqual(CALL + 64);
      perCall.push(meter.bytes / calls);
    }
    expect((perCall[1] ?? 0) / (perCall[0] ?? 1)).toBeLessThanOrEqual(1.1);
  });

  it('fs.read(fd) callbacks move the same range only', async () => {
    const bytes = pattern(1 * MiB);
    const meter: Meter = { bytes: 0 };
    setSyncMirror(host(ownerWith(bytes), meter));
    const fd = openSync('/data/f.bin', 'r');
    const buffer = new Uint8Array(CALL);
    let total = 0;
    for (;;) {
      const n = await new Promise<number>((resolve, reject) =>
        read(fd, buffer, 0, CALL, null, (error, count) =>
          error ? reject(error) : resolve(count ?? 0),
        ),
      );
      if (n === 0) break;
      total += n;
    }
    closeSync(fd);
    expect(total).toBe(bytes.byteLength);
    expect(meter.bytes).toBeLessThanOrEqual(bytes.byteLength * 1.1);
  });
});

describe('readSync(fd) over sync-RPC: a range longer than one exchange', () => {
  it('reads a multi-exchange range exactly and moves only it', () => {
    const size = 3 * FS_RPC_CHUNK + 5;
    const bytes = pattern(size);
    const meter: Meter = { bytes: 0 };
    setSyncMirror(overRpc(ownerWith(bytes), meter));
    const fd = openSync('/data/f.bin', 'r');
    const buffer = new Uint8Array(2 * FS_RPC_CHUNK + 3);
    expect(readSync(fd, buffer, 0, buffer.byteLength, 100)).toBe(buffer.byteLength);
    expect(
      Buffer.compare(
        Buffer.from(buffer),
        Buffer.from(bytes.subarray(100, 100 + buffer.byteLength)),
      ),
    ).toBe(0);
    expect(meter.bytes).toBe(buffer.byteLength);
    closeSync(fd);
  });
});

describe('readSync(fd) over sync-RPC: a concurrent writer', () => {
  function rpcWithHook(owner: FsSync, onChunk: (count: number) => void): FsSync {
    const handlers = handlersOf(() => owner);
    let chunks = 0;
    return createTestSyncRpcFs((method, payload) => {
      const handler = handlers.get(method);
      if (handler === undefined) throw new Error(`missing handler ${method}`);
      const value = handler(payload);
      if (method === 'fs.readChunk') onChunk(++chunks);
      return value;
    });
  }

  it('a write between two calls is seen whole by the next call', () => {
    const owner = ownerWith(new Uint8Array(8).fill(1));
    setSyncMirror(rpcWithHook(owner, () => {}));
    const fd = openSync('/data/f.bin', 'r');
    const buffer = new Uint8Array(4);
    expect(readSync(fd, buffer, 0, 4, null)).toBe(4);
    owner.writeFileSync('/data/f.bin', new Uint8Array(6).fill(2));
    expect(readSync(fd, buffer, 0, 4, null)).toBe(2);
    expect(Array.from(buffer)).toEqual([2, 2, 1, 1]);
    closeSync(fd);
  });

  it('an append between the exchanges of one long range returns the range unchanged (as main and Node)', () => {
    const size = 3 * FS_RPC_CHUNK;
    const original = pattern(size);
    const owner = ownerWith(original);
    setSyncMirror(
      rpcWithHook(owner, (count) => {
        if (count === 1) {
          const longer = new Uint8Array(size + 10);
          longer.set(original);
          owner.writeFileSync('/data/f.bin', longer);
        }
      }),
    );
    const fd = openSync('/data/f.bin', 'r');
    const buffer = new Uint8Array(size);
    expect(readSync(fd, buffer, 0, size, 0)).toBe(size);
    expect(Buffer.compare(Buffer.from(buffer), Buffer.from(original))).toBe(0);
    closeSync(fd);
  });

  it("a rewrite between the exchanges of one long range: each piece is its exchange's snapshot, no error", () => {
    const size = 3 * FS_RPC_CHUNK;
    const owner = ownerWith(new Uint8Array(size).fill(1));
    setSyncMirror(
      rpcWithHook(owner, (count) => {
        if (count === 1) owner.writeFileSync('/data/f.bin', new Uint8Array(size).fill(2));
      }),
    );
    const fd = openSync('/data/f.bin', 'r');
    const buffer = new Uint8Array(size);
    expect(readSync(fd, buffer, 0, size, 0)).toBe(size);
    expect(buffer.subarray(0, FS_RPC_CHUNK).every((byte) => byte === 1)).toBe(true);
    expect(buffer.subarray(FS_RPC_CHUNK).every((byte) => byte === 2)).toBe(true);
    closeSync(fd);
  });
});
