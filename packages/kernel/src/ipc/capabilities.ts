/**
 * Capability gate for SAB-based IPC (ADR-0011 phase 1).
 *
 * Sync IPC via {@link SharedArrayBuffer} + {@link Atomics.wait} requires:
 *   - `crossOriginIsolated === true` — the page (or Worker) must be served
 *     with COOP/COEP headers. Without isolation, SAB is unavailable in
 *     modern browsers regardless of the global being present.
 *   - `SharedArrayBuffer` constructor available.
 *   - `Atomics.waitAsync` — present in all engines that ship SAB to web
 *     content today, but check anyway so older Node test environments
 *     fall through cleanly.
 *
 * When any of these is missing, callers fall back to the same-realm
 * `new Function`-in-realm path (the pre-ADR-0011 behaviour). The same
 * `IpcMode` callers may also pass `forceFallback: true` to disable SAB
 * explicitly (used by tests and by non-isolated previews that want to
 * exercise the fallback path even on capable hosts). The kernel itself
 * never reads `process.env` (ADR-0039 — kernel is Node-API-free); the
 * decision is owned by whoever calls {@link getIpcMode}. The playground
 * reads the `RIFTY_FALLBACK_NO_SAB` env override (and any user-supplied
 * global flag) and passes the result through.
 */

type IpcMode = 'sab' | 'same-realm-fallback';

/**
 * Returns `true` when the current realm supports the SAB IPC transport
 * (cross-origin isolated AND has SharedArrayBuffer + Atomics.waitAsync).
 */
export function isSabIpcSupported(): boolean {
  const g = globalThis as typeof globalThis & { crossOriginIsolated?: boolean };
  if (g.crossOriginIsolated !== true) return false;
  if (typeof SharedArrayBuffer !== 'function') return false;
  // `Atomics.waitAsync` ships in ES2024; lib target is ES2023 so we probe
  // via a structural cast rather than dereferencing the typed name.
  const atomicsWithWaitAsync = Atomics as unknown as { waitAsync?: unknown };
  if (typeof Atomics === 'undefined' || typeof atomicsWithWaitAsync.waitAsync !== 'function') {
    return false;
  }
  return true;
}

/**
 * Optional inputs to {@link getIpcMode}. The kernel deliberately exposes
 * `forceFallback` as a parameter (rather than reading from `process.env`)
 * so callers above the kernel layer own the env / global-flag coupling.
 * ADR-0039 — kernel stays Node-API-free; runtime-js / playground are the
 * places that may legitimately consult `process.env`.
 */
export interface IpcModeOptions {
  /**
   * When `true`, returns `'same-realm-fallback'` regardless of whether
   * the host supports SAB IPC. Defaults to `false`. Tests and non-isolated
   * previews that want to exercise the fallback path on a capable host
   * pass `true`; production callers leave it unset.
   */
  forceFallback?: boolean;
}

/**
 * Returns the effective IPC mode for the current realm. Use this from
 * {@link kernel.spawn} (added in phase 2) to decide whether to instantiate
 * a real Worker with a SAB ring or to fall back to the same-realm path.
 *
 * @param options - See {@link IpcModeOptions}.
 */
export function getIpcMode(options: IpcModeOptions = {}): IpcMode {
  if (options.forceFallback === true) return 'same-realm-fallback';
  if (!isSabIpcSupported()) return 'same-realm-fallback';
  return 'sab';
}
