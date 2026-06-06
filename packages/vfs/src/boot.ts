/**
 * Runtime backend selection for the VFS layer (ADR-0013).
 *
 * Browser deploys prefer OPFS for persistence; everything else (Node
 * tests, non-isolated fallback, private-mode browsers) uses memory.
 *
 * Realm-aware: even when OPFS is available on the main thread,
 * `OpfsFsSync` (sync side) only works inside a Worker — so wiring the
 * sync surface to OPFS must happen from the Worker that will call
 * `fs.readFileSync`, the same realm where `initBackend()` runs.
 */

import { OpfsVfs } from './opfs.ts';
import { installMemoryFs, installOpfsFs } from './sync-mirror.ts';

declare const crossOriginIsolated: boolean | undefined;

/**
 * Returns `'opfs'` when the realm is cross-origin isolated and the async
 * OPFS API is present, otherwise `'memory'`. Pure — touches no global state.
 */
export function detectVfsBackend(): 'opfs' | 'memory' {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  if (!isolated) return 'memory';
  return OpfsVfs.isSupported() ? 'opfs' : 'memory';
}

/**
 * Wires the active backend in one call; both `syncMirror()` and
 * `asyncVfs()` then point at the selected (OPFS- or memory-paired) backend.
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
