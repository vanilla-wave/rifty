/**
 * Unit tests for clock-related WASI preview1 syscalls.
 *
 * We don't need a VFS — just a memory buffer to receive the u64 timestamp.
 * `clock_time_get` now lives in {@link ./proc.ts} (process-level concerns
 * grouped together); these tests pull just the clock surface out of that
 * factory.
 */
import { describe, expect, it } from 'vitest';
import { procSyscalls } from './proc.ts';
import {
  CLOCKID_MONOTONIC,
  CLOCKID_PROCESS_CPUTIME_ID,
  CLOCKID_REALTIME,
  CLOCKID_THREAD_CPUTIME_ID,
  E_INVAL,
  E_SUCCESS,
  type WasiCtx,
} from './shared.ts';

type ClockTimeGetFn = (id: number, precision: bigint, outPtr: number) => number;

interface ClockNs {
  clock_time_get: ClockTimeGetFn;
}

function setupCtx(): {
  ctx: WasiCtx;
  ns: ClockNs;
  memory: WebAssembly.Memory;
} {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds: new Map(),
    cwdFd: 3,
    nextFd: { value: 3 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
    onStdin: () => null,
    view: () => new DataView(memory.buffer),
    bytes: () => new Uint8Array(memory.buffer),
  };
  // Bridge from string-keyed ModuleImports to a typed view for tests.
  const ns = procSyscalls(ctx) as unknown as ClockNs;
  return { ctx, ns, memory };
}

describe('clock_time_get', () => {
  it('returns CLOCKID_REALTIME as wall-clock nanos (close to Date.now())', () => {
    const t = setupCtx();
    const view = new DataView(t.memory.buffer);
    const before = BigInt(Date.now()) * 1_000_000n;
    const rc = t.ns.clock_time_get(CLOCKID_REALTIME, 0n, 100);
    const after = BigInt(Date.now()) * 1_000_000n;
    expect(rc).toBe(E_SUCCESS);
    const ns = view.getBigUint64(100, true);
    // Allow generous wall-clock window (CI clocks). Just bound it.
    expect(ns >= before - 1_000_000_000n).toBe(true);
    expect(ns <= after + 1_000_000_000n).toBe(true);
  });

  it('returns CLOCKID_MONOTONIC as monotonic nanos (close to performance.now())', () => {
    const t = setupCtx();
    const view = new DataView(t.memory.buffer);
    const before = BigInt(Math.floor(performance.now() * 1e6));
    const rc = t.ns.clock_time_get(CLOCKID_MONOTONIC, 0n, 100);
    const after = BigInt(Math.floor(performance.now() * 1e6));
    expect(rc).toBe(E_SUCCESS);
    const ns = view.getBigUint64(100, true);
    // Monotonic should be within the window — allow a 1ms slop.
    expect(ns >= before - 1_000_000n).toBe(true);
    expect(ns <= after + 1_000_000n).toBe(true);
  });

  it('reads as a different timebase for REALTIME vs MONOTONIC', () => {
    const t = setupCtx();
    const view = new DataView(t.memory.buffer);
    t.ns.clock_time_get(CLOCKID_REALTIME, 0n, 100);
    const realtime = view.getBigUint64(100, true);
    t.ns.clock_time_get(CLOCKID_MONOTONIC, 0n, 108);
    const monotonic = view.getBigUint64(108, true);
    // Realtime is unix epoch nanoseconds (~10^18 today); monotonic is process
    // uptime nanoseconds (~10^9 to 10^13 at most for a CI run). They must
    // differ by orders of magnitude — guarding that they aren't accidentally
    // the same value.
    expect(realtime).not.toBe(monotonic);
    expect(realtime > monotonic).toBe(true);
  });

  it('returns E_INVAL for CLOCKID_PROCESS_CPUTIME_ID (unsupported)', () => {
    const t = setupCtx();
    const rc = t.ns.clock_time_get(CLOCKID_PROCESS_CPUTIME_ID, 0n, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('returns E_INVAL for CLOCKID_THREAD_CPUTIME_ID (unsupported)', () => {
    const t = setupCtx();
    const rc = t.ns.clock_time_get(CLOCKID_THREAD_CPUTIME_ID, 0n, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('returns E_INVAL for unknown clock ids', () => {
    const t = setupCtx();
    const rc = t.ns.clock_time_get(99, 0n, 100);
    expect(rc).toBe(E_INVAL);
  });
});
