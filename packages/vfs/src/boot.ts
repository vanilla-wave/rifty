/**
 * Runtime backend selection for the VFS layer (ADR-0013).
 *
 * Browser Worker realms with sync-access-handle capability prefer OPFS for
 * persistence; everything else (Node, main windows, unsupported browsers)
 * uses memory.
 *
 * Realm-aware: even when OPFS is available on the main thread,
 * `OpfsFsSync` (sync side) only works inside a Worker — so wiring the
 * sync surface to OPFS must happen from the Worker that will call
 * `fs.readFileSync`, the same realm where `initBackend()` runs.
 */

import { OpfsFsSync } from './opfs-sync.ts';
import { installMemoryFs, installOpfsFs } from './sync-mirror.ts';

/**
 * Returns `'opfs'` when this realm can host the paired sync OPFS backend,
 * otherwise `'memory'`. Pure — touches no global state.
 */
export function detectVfsBackend(): 'opfs' | 'memory' {
  return OpfsFsSync.isSupported() ? 'opfs' : 'memory';
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
