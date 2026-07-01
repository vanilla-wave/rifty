/**
 * Preview warm-up state machine, extracted from PreviewPanel for deterministic
 * unit tests (injected probe/clock/wake). Two phases:
 *  1. PROBE the /preview/<port>/ route until it answers ok — between probes
 *     wait `warmupIntervalMs` OR an external `wake()` (dev-server announce),
 *     whichever first. A probe launched before the preview bridge is wired can
 *     hang in the SW ready-wait up to its cap; waking on the announce re-probes
 *     immediately instead of paying that cap + interval.
 *  2. NAVIGATE the frame (even after a probe timeout — the commit phase is the
 *     arbiter, matching the old inline loop), then confirm the document
 *     committed — checked immediately and on every wake/interval tick.
 */
export interface PreviewWarmupHooks {
  /** One GET probe of the preview route; resolves true on `res.ok`, false on
   * any failure (never throws — the caller's fetch wrapper owns that). */
  readonly probe: (signal: AbortSignal) => Promise<boolean>;
  /** Remount the iframe and start navigation to the preview URL. */
  readonly navigate: () => Promise<void>;
  /** Did the iframe commit a document at the preview URL? */
  readonly committed: () => boolean;
  /** Arm a one-shot external readiness signal; a fresh promise per call. */
  readonly wake: () => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

export interface PreviewWarmupConfig {
  readonly warmupTimeoutMs: number;
  readonly warmupIntervalMs: number;
  readonly probeTimeoutMs: number;
  readonly commitTimeoutMs: number;
  readonly commitIntervalMs: number;
}

export async function runPreviewWarmup(
  hooks: PreviewWarmupHooks,
  cfg: PreviewWarmupConfig,
  isAlive: () => boolean,
): Promise<'live' | 'error' | 'cancelled'> {
  const probeDeadline = hooks.now() + cfg.warmupTimeoutMs;
  while (isAlive() && hooks.now() < probeDeadline) {
    const ac = new AbortController();
    const cap = setTimeout(() => ac.abort(), cfg.probeTimeoutMs);
    let ok: boolean;
    try {
      ok = await hooks.probe(ac.signal);
    } finally {
      clearTimeout(cap);
    }
    if (!isAlive()) return 'cancelled';
    if (ok) break;
    await Promise.race([hooks.sleep(cfg.warmupIntervalMs), hooks.wake()]);
  }
  if (!isAlive()) return 'cancelled';
  await hooks.navigate();
  const commitDeadline = hooks.now() + cfg.commitTimeoutMs;
  while (isAlive()) {
    if (hooks.committed()) return 'live';
    if (hooks.now() >= commitDeadline) return 'error';
    await Promise.race([hooks.sleep(cfg.commitIntervalMs), hooks.wake()]);
  }
  return 'cancelled';
}
