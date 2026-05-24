/**
 * The fs built-in needs a VFS to write through. The runtime injects one at
 * Worker boot; tests inject a `MemoryVfs` directly.
 *
 * The "fsVfs" indirection lets us swap the backing store (memory, OPFS, future
 * remote) without touching the Node API surface.
 */
import { MemoryVfs, type Vfs } from '@rifty/vfs';

let active: Vfs = new MemoryVfs();

export function getFsVfs(): Vfs {
  return active;
}

export function setFsVfs(vfs: Vfs): void {
  active = vfs;
}

/**
 * Resets the active backend to a fresh in-memory VFS. Used by tests between
 * runs to avoid cross-contamination.
 */
export function resetFsVfs(): void {
  active = new MemoryVfs();
}
