/**
 * Perf-guard #2 (perf audit 2026-06-05): `EventEmitter.emit()` has a
 * single-listener fast path that reads the lone entry into a local instead of
 * snapshotting the array via `arr.slice()`. With exactly one listener, a hot
 * emit loop must NOT allocate a slice per emit.
 *
 * RED-on-revert: revert `emit()` to always `arr.slice()` and the single-listener
 * `it` goes red (slice count == N). The 2-listener companion proves the
 * fast-path edit did NOT drop the len>1 snapshot safety (still slices once per
 * emit) — the snapshot is what lets a listener mutate the array mid-emit safely.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './event-emitter.ts';

describe('EventEmitter emit single-listener fast path (#2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emitting to ONE listener N times calls Array.prototype.slice ZERO times', () => {
    const ee = new EventEmitter();
    let fired = 0;
    ee.on('data', () => {
      fired++;
    });

    // Scope the slice spy to the emit window only — addListener above may slice
    // for its own bookkeeping; we count slices DURING the burst.
    const sliceSpy = vi.spyOn(Array.prototype, 'slice');
    const N = 10000;
    for (let i = 0; i < N; i++) ee.emit('data', i);
    const slices = sliceSpy.mock.calls.length;
    sliceSpy.mockRestore();

    expect(fired).toBe(N);
    // Fast path: local read, no per-emit snapshot. Always-slice => N.
    expect(slices).toBe(0);
  });

  it('with TWO listeners, emit DOES snapshot via slice (len>1 safety preserved)', () => {
    const ee = new EventEmitter();
    let a = 0;
    let b = 0;
    ee.on('data', () => {
      a++;
    });
    ee.on('data', () => {
      b++;
    });

    const sliceSpy = vi.spyOn(Array.prototype, 'slice');
    const N = 100;
    for (let i = 0; i < N; i++) ee.emit('data', i);
    const slices = sliceSpy.mock.calls.length;
    sliceSpy.mockRestore();

    expect(a).toBe(N);
    expect(b).toBe(N);
    // One snapshot per emit keeps mid-emit mutation (once-wrappers /
    // removeListener-during-emit) from perturbing the in-flight iteration.
    expect(slices).toBeGreaterThanOrEqual(N);
  });

  it('the single-listener fast path still isolates a once-wrapper that mutates mid-call', () => {
    // A `once` listener removes itself before invoking the user fn. The
    // fast path captures the entry into a local BEFORE applying it, so the
    // self-removal cannot perturb the in-flight call. It must fire exactly once.
    const ee = new EventEmitter();
    let fired = 0;
    ee.once('data', () => {
      fired++;
    });
    ee.emit('data');
    ee.emit('data'); // already removed — must not fire again
    expect(fired).toBe(1);
    expect(ee.listenerCount('data')).toBe(0);
  });
});
