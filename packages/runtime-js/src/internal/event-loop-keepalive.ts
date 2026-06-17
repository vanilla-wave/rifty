/**
 * Event-loop keepalive for run-to-completion child realms
 * (child-realm-async-lifecycle). A libuv-style refcount of handles that keep the
 * loop alive (timers/immediates/pending dynamic imports). `awaitDrain` resolves
 * once the count hits zero — the kernel drain seam (ADR-0039) awaits it before
 * reaping, so a child exits on "loop empty" like Node, not at top-level resolve.
 *
 * Loud-fail (no silent stub): a recorded `unhandledrejection` rejects the drain
 * (→ kernel stderr + exit 1); a never-draining loop rejects with a
 * self-explanatory cap error rather than hanging the worker forever. The cap is
 * a SAFETY-NET, not a faithfulness feature (Node has no cap) — generous + loud +
 * documented (see ADR + compat matrix).
 */

let refCount = 0;
let rejection: { reason: unknown } | null = null;

/** Increment the active-handle count (timer/immediate/import scheduled). */
export function ref(): void {
  refCount += 1;
}

/** Decrement the active-handle count (handle fired/cleared/settled). Floors at 0. */
export function unref(): void {
  if (refCount > 0) refCount -= 1;
}

/** Current active-handle count. */
export function activeRefs(): number {
  return refCount;
}

/** Record the first unhandled rejection so `awaitDrain` surfaces it loudly. */
export function recordRejection(reason: unknown): void {
  if (rejection === null) rejection = { reason };
}

/** Test-only: reset module state between cases. */
export function resetKeepalive(): void {
  refCount = 0;
  rejection = null;
}

/** Generous default cap — a safety-net against a genuine hang/leak, not Node parity. */
export const DEFAULT_DRAIN_CAP_MS = 30_000;

export interface DrainOptions {
  capMs?: number;
  /** Schedule a check on the MACROTASK queue (seam for tests; defaults to setTimeout 0). */
  scheduleMacrotask?: (cb: () => void) => void;
  /** Monotonic clock (seam for tests; defaults to performance.now). */
  now?: () => number;
}

/**
 * Resolve once the event loop has drained (refCount→0), reject on a recorded
 * rejection or once `capMs` elapses without draining.
 *
 * The first check runs on the MACROTASK queue so all pending microtasks (e.g. a
 * detached `import(...).then(run)` chain whose loader reads are microtask-driven)
 * complete before refCount is first sampled — that is what makes the prettier-
 * class detached promise reach `run()` before the realm is reaped.
 */
export function awaitDrain(opts: DrainOptions = {}): Promise<void> {
  const capMs = opts.capMs ?? DEFAULT_DRAIN_CAP_MS;
  const schedule =
    opts.scheduleMacrotask ??
    ((cb: () => void) => {
      setTimeout(cb, 0);
    });
  const now = opts.now ?? (() => performance.now());
  const start = now();
  return new Promise<void>((resolve, reject) => {
    const tick = (): void => {
      if (rejection !== null) {
        const r = rejection.reason;
        reject(r instanceof Error ? r : new Error(String(r)));
        return;
      }
      if (refCount <= 0) {
        resolve();
        return;
      }
      if (now() - start > capMs) {
        reject(
          new Error(
            `child realm exceeded keepalive drain cap (${capMs}ms) — suspected hang or leaked handle (${refCount} active ref(s))`,
          ),
        );
        return;
      }
      schedule(tick);
    };
    schedule(tick);
  });
}
