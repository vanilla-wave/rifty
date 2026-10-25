/**
 * Slow-path affordance around an awaited step: signal `onSlow` once if `work`
 * hasn't settled within `delayMs`. A fast settle stays silent (no flash of a
 * progress label for a no-op); the result or rejection propagates untouched.
 *
 * Motivation (measured 2026-07-02, throttled prod build): an instant preset's
 * baked node_modules snapshot restore (9.6-16 MB download in the owner) left
 * seconds of dead-silent UI on a real network.
 */
export interface SlowProgressOptions {
  readonly delayMs: number;
  readonly onSlow: () => void;
}

export async function withSlowProgress<T>(work: Promise<T>, opts: SlowProgressOptions): Promise<T> {
  const timer = setTimeout(opts.onSlow, opts.delayMs);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
  }
}
