/**
 * Pure size math for the hand-rolled {@link ../components/Splitter.tsx | Splitter}
 * (ADR-0075). Kept Solid-free so the clamp/delta logic is unit-testable without
 * a DOM or a reactive root — the component is a thin pointer-event shell over
 * these two functions.
 */

/**
 * Clamp `px` into `[min, max]`, integer-rounded. Tolerant of a reversed
 * `min`/`max` pair (uses the actual lo/hi) and of `NaN` (returns the low
 * bound) so a stale persisted value can never wedge a panel off-screen.
 */
export function clampSize(px: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (Number.isNaN(px)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(px)));
}

/**
 * The next clamped size given a drag that started at `start` and has moved by
 * `delta` px along the splitter's axis. The caller chooses `delta`'s sign so a
 * handle on either side of its panel grows the panel intuitively.
 */
export function nextSizeFromDelta(
  start: number,
  delta: number,
  min: number,
  max: number,
): number {
  return clampSize(start + delta, min, max);
}
