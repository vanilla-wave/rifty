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
 * `new Function`-in-realm path (the pre-ADR-0011 behaviour). Tests and
 * non-isolated previews disable SAB explicitly via `RIFTY_FALLBACK_NO_SAB`.
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

interface EnvCapableGlobal {
  process?: { env?: Record<string, string | undefined> };
  Deno?: { env?: { get(key: string): string | undefined } };
}

/**
 * Reads the `RIFTY_FALLBACK_NO_SAB` env override. Returns `true` when the
 * variable is set to any non-empty, non-`0`/`false` value.
 *
 * Reads from `process.env` (Node) or `Deno.env` (Deno) when available.
 * Returns `false` in plain browser realms (no env access by design — the
 * playground sets a global flag instead, which higher layers consult).
 */
function isFallbackForced(): boolean {
  const g = globalThis as EnvCapableGlobal;
  const v = g.process?.env?.RIFTY_FALLBACK_NO_SAB ?? g.Deno?.env?.get('RIFTY_FALLBACK_NO_SAB');
  if (!v) return false;
  const lower = v.toLowerCase();
  return lower !== '0' && lower !== 'false';
}

/**
 * Returns the effective IPC mode for the current realm. Use this from
 * {@link kernel.spawn} (added in phase 2) to decide whether to instantiate
 * a real Worker with a SAB ring or to fall back to the same-realm path.
 */
export function getIpcMode(): IpcMode {
  if (isFallbackForced()) return 'same-realm-fallback';
  if (!isSabIpcSupported()) return 'same-realm-fallback';
  return 'sab';
}
