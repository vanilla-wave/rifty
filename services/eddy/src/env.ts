/**
 * Env-config parsing for the eddy bin (D-004 style at the server boundary).
 */

/**
 * Parse `EDDY_TTL_SECONDS`. Unset → `undefined` (the cache uses its default
 * TTL). Otherwise it MUST be a finite number ≥ 0 (`0` = always recompute).
 *
 * A junk value (`abc`, `30s`) coerces to `NaN`, and `NaN` silently kills the
 * mutable-tier cache (`ttlMs = NaN` → every gate `NaN > x` is false → each
 * request recomputes). Refuse it loudly at startup rather than shipping a dead
 * cache — the loud-failure ethos.
 */
export function parseTtlSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  // `Number(' ')`/`Number('\t')` coerce to 0 (not NaN), so a whitespace-only
  // value would slip past the finite/≥0 gate and silently set TTL 0 (always
  // recompute) — a dead cache. Treat it as junk, not "0".
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `EDDY_TTL_SECONDS must be a non-negative number of seconds (0 = always recompute); got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}
