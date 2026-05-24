/**
 * Runtime backend selection for the VFS layer (ADR-0013).
 *
 * Browser deploys prefer OPFS for persistence; everything else (Node
 * tests, non-isolated dev fallback, private-mode browsers) falls back to
 * the in-memory backend. `detectVfsBackend()` is the single decision
 * point — it returns `'opfs'` iff the realm is cross-origin-isolated
 * and exposes the OPFS async API. `initBackend()` is the bootstrap
 * call sites use to wire both surfaces in one shot.
 *
 * The decision is realm-aware: even when OPFS is available on the main
 * thread, `OpfsFsSync` (sync side) only works inside a Worker. Wiring
 * the sync surface to OPFS therefore must happen from within the
 * Worker that intends to call `fs.readFileSync` — which is the same
 * realm where this module's `initBackend()` should be invoked.
 */

import { OpfsVfs } from './opfs.ts';
import { installMemoryFs, installOpfsFs } from './sync-mirror.ts';

declare const crossOriginIsolated: boolean | undefined;

/**
 * Returns `'opfs'` when the current realm can host the OPFS-backed VFS
 * (cross-origin isolated and the async OPFS API is present), otherwise
 * `'memory'`. Pure function — does not touch any global state.
 */
export function detectVfsBackend(): 'opfs' | 'memory' {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  if (!isolated) return 'memory';
  return OpfsVfs.isSupported() ? 'opfs' : 'memory';
}

/**
 * Wires the active backend in one call. After resolution, `syncMirror()`
 * and `asyncVfs()` both point at the selected backend (OPFS-paired or
 * memory-paired).
 */
export async function initBackend(): Promise<'opfs' | 'memory'> {
  const choice = detectVfsBackend();
  if (choice === 'opfs') {
    await installOpfsFs();
  } else {
    installMemoryFs();
  }
  return choice;
}
