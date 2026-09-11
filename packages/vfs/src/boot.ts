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

export interface VfsStorageOptions {
  readonly namespace?: string;
  readonly persistence?: 'required' | 'preferred' | 'ephemeral';
}

/** One literal native component; omission keeps the historical origin root. */
export function validateStorageNamespace(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    /[\0/\\]/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new TypeError('storage.namespace must be one non-empty literal OPFS directory component');
  return value;
}

export function captureVfsStorageOptions(value: unknown): VfsStorageOptions | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError('storage must be a plain object');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).some((key) => key !== 'namespace' && key !== 'persistence') ||
    Object.values(fields).some((field) => !('value' in field))
  )
    throw new TypeError('storage has unsupported fields');
  const namespace = validateStorageNamespace(fields.namespace?.value);
  const persistence: unknown =
    fields.persistence?.value === undefined ? 'preferred' : fields.persistence.value;
  if (persistence !== 'required' && persistence !== 'preferred' && persistence !== 'ephemeral')
    throw new TypeError('storage.persistence must be required, preferred or ephemeral');
  return Object.freeze({ persistence, ...(namespace === undefined ? {} : { namespace }) });
}

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
export async function initBackend(options?: VfsStorageOptions): Promise<'opfs' | 'memory'> {
  const storage = captureVfsStorageOptions(options);
  if (storage?.persistence === 'ephemeral') {
    installMemoryFs();
    return 'memory';
  }
  const choice = detectVfsBackend();
  if (choice === 'opfs') {
    const namespace = storage?.namespace;
    const root =
      namespace === undefined
        ? undefined
        : await (await navigator.storage.getDirectory()).getDirectoryHandle(namespace, {
            create: true,
          });
    await installOpfsFs(root);
  } else {
    if (storage !== undefined) throw new Error('OPFS is unavailable in this realm');
    installMemoryFs();
  }
  return choice;
}
