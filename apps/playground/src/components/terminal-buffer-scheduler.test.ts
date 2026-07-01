import { describe, expect, it } from 'vitest';
import { createBufferRefreshScheduler } from './terminal-buffer-scheduler.ts';

/** Deterministic timer + clock: timers fire when the clock is advanced past them. */
function fakeEnv() {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const setTimer = ((cb: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { at: clock + Math.max(0, ms), cb });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as BufferTimer;
  const clearTimer = (handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle as unknown as number);
  };
  const now = () => clock;
  function advance(ms: number): void {
    const target = clock + ms;
    for (;;) {
      let bestId: number | undefined;
      let bestAt = Number.POSITIVE_INFINITY;
      for (const [id, t] of timers) {
        if (t.at <= target && t.at < bestAt) {
          bestAt = t.at;
          bestId = id;
        }
      }
      if (bestId === undefined) break;
      const t = timers.get(bestId);
      timers.delete(bestId);
      if (t) {
        clock = t.at;
        t.cb();
      }
    }
    clock = target;
  }
  return { setTimer, clearTimer, now, advance };
}
type BufferTimer = (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;

describe('createBufferRefreshScheduler', () => {
  it('debounces a single burst — fires after debounceMs of quiet', () => {
    const env = fakeEnv();
    let n = 0;
    const s = createBufferRefreshScheduler(() => n++, { debounceMs: 16, maxWaitMs: 150, ...env });
    s.schedule();
    env.advance(15);
    expect(n).toBe(0);
    env.advance(2);
    expect(n).toBe(1);
  });

  // The regression guard: a reset-on-every-write debounce (the original bug)
  // would NEVER fire under continuous sub-debounce scheduling → the mirror
  // freezes → the dev-server-ready marker is never observed. The maxWait cap
  // must still fire it.
  it('does NOT starve under continuous sub-debounce scheduling (maxWait cap)', () => {
    const env = fakeEnv();
    let n = 0;
    const s = createBufferRefreshScheduler(() => n++, { debounceMs: 16, maxWaitMs: 150, ...env });
    // A write every 10ms (< debounce) for 320ms — an unbroken output stream.
    for (let i = 0; i < 32; i++) {
      s.schedule();
      env.advance(10);
    }
    // ~320ms / 150ms cap → at least two forced refreshes (a reset-debounce: 0).
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('starts a fresh maxWait window after each fire', () => {
    const env = fakeEnv();
    let n = 0;
    const s = createBufferRefreshScheduler(() => n++, { debounceMs: 16, maxWaitMs: 150, ...env });
    s.schedule();
    env.advance(20); // first burst fires
    expect(n).toBe(1);
    s.schedule();
    env.advance(20); // second, independent burst fires
    expect(n).toBe(2);
  });

  it('cancel() drops a pending refresh', () => {
    const env = fakeEnv();
    let n = 0;
    const s = createBufferRefreshScheduler(() => n++, { debounceMs: 16, maxWaitMs: 150, ...env });
    s.schedule();
    s.cancel();
    env.advance(1000);
    expect(n).toBe(0);
  });
});
