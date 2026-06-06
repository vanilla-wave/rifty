/**
 * Capability gate for SAB-based IPC (ADR-0011 phase 1).
 *
 * Sync IPC via {@link SharedArrayBuffer} + {@link Atomics.wait} requires:
 *   - `crossOriginIsolated === true` — needs COOP/COEP headers; without
 *     isolation SAB is unavailable in modern browsers even if the global exists.
 *   - `SharedArrayBuffer` constructor.
 *   - `Atomics.waitAsync` — checked anyway so older Node test envs fall through.
 *
 * When any is missing, callers fall back to the same-realm `new Function`
 * path (pre-ADR-0011 behaviour). Kernel never reads `process.env`
 * (ADR-0039 — Node-API-free); the playground reads the `RIFTY_FALLBACK_NO_SAB`
 * override and passes the result via `forceFallback`.
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
  // `Atomics.waitAsync` ships in ES2024 but lib target is ES2023 — probe via
  // structural cast rather than the typed name.
  const atomicsWithWaitAsync = Atomics as unknown as { waitAsync?: unknown };
  if (typeof Atomics === 'undefined' || typeof atomicsWithWaitAsync.waitAsync !== 'function') {
    return false;
  }
  return true;
}

/**
 * Optional inputs to {@link getIpcMode}. `forceFallback` is a parameter
 * (not a `process.env` read) so callers above the kernel own the env coupling.
 * ADR-0039 — kernel stays Node-API-free; runtime-js / playground consult env.
 */
export interface IpcModeOptions {
  /**
   * When `true`, returns `'same-realm-fallback'` regardless of host SAB
   * support (default `false`). For tests and non-isolated previews exercising
   * the fallback path on a capable host.
   */
  forceFallback?: boolean;
}

/**
 * Returns the effective IPC mode for the current realm. Used by
 * {@link kernel.spawn} (phase 2) to choose a real Worker with a SAB ring vs.
 * the same-realm path.
 *
 * @param options - See {@link IpcModeOptions}.
 */
export function getIpcMode(options: IpcModeOptions = {}): IpcMode {
  if (options.forceFallback === true) return 'same-realm-fallback';
  if (!isSabIpcSupported()) return 'same-realm-fallback';
  return 'sab';
}
