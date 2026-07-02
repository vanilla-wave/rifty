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
  const WAKE = Symbol('wake');
  while (isAlive() && hooks.now() < probeDeadline) {
    // ONE wake arm per iteration, shared by the probe race AND the interval
    // sleep below — two arms would leave a gap (probe settled, sleep not yet
    // awaited) where an announce resolves an abandoned promise and is lost.
    const wake = hooks.wake().then(() => WAKE);
    const ac = new AbortController();
    const cap = setTimeout(() => ac.abort(), cfg.probeTimeoutMs);
    let raced: boolean | symbol;
    try {
      // A probe hung in the SW ready-wait must not make the announce wait out
      // probeTimeoutMs — the wake aborts it and re-probes immediately.
      raced = await Promise.race([hooks.probe(ac.signal), wake]);
    } finally {
      clearTimeout(cap);
    }
    if (!isAlive()) return 'cancelled';
    if (raced === true) break;
    if (raced === WAKE) {
      ac.abort();
      continue;
    }
    await Promise.race([hooks.sleep(cfg.warmupIntervalMs), wake]);
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
