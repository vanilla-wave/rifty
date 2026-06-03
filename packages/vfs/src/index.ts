/**
 * Public surface of `@riftydev/vfs`. Anything callers should be able to import
 * by name from `@riftydev/vfs` lives here; runtime-wiring helpers
 * (`setSyncMirror`, `MemoryBackend`, etc.) live under `@riftydev/vfs/internal`
 * and are NOT considered stable across versions.
 */
export type { Vfs, VfsStat, VfsDirent, VfsErrorCode } from './types.ts';
export { VfsError, NotImplementedError } from './errors.ts';
export { MemoryVfs } from './memory.ts';
export { OpfsVfs } from './opfs.ts';
export { OpfsFsSync } from './opfs-sync.ts';
export {
  joinPath,
  normalizePath,
  dirname,
  basename,
  extname,
  isAbsolute,
  segments,
} from './path.ts';
export { syncMirror, asyncVfs } from './sync-mirror.ts';
export type { FsSync } from './sync-mirror.ts';
export { detectVfsBackend, initBackend } from './boot.ts';
