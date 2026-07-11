/**
 * Slow-path affordance around an awaited step: signal `onSlow` once if `work`
 * hasn't settled within `delayMs`, and report total elapsed on a SLOW success.
 * A fast settle stays silent (no flash of a progress line for a no-op), and a
 * failure never claims completion — the rejection propagates untouched.
 *
 * Motivation (measured 2026-07-02, throttled prod build): an instant preset's
 * `setDevConfig` gates the boot-line echo on the baked node_modules snapshot
 * restore (9.6-16 MB download in the owner) — seconds of dead-silent terminal
 * on a real network, then command + result paint together.
 */
export interface SlowProgressOptions {
  readonly delayMs: number;
  readonly onSlow: () => void;
  /** Called on success ONLY when `onSlow` fired; receives total elapsed ms. */
  readonly onSettledAfterSlow?: (elapsedMs: number) => void;
  /** Test seam; defaults to `Date.now`. */
  readonly now?: () => number;
}

export async function withSlowProgress<T>(work: Promise<T>, opts: SlowProgressOptions): Promise<T> {
  const now = opts.now ?? Date.now;
  const started = now();
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    opts.onSlow();
  }, opts.delayMs);
  try {
    const result = await work;
    if (slow) opts.onSettledAfterSlow?.(now() - started);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
