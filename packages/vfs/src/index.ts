export type { Vfs, VfsStat, VfsDirent, VfsErrorCode } from './types.ts';
export { VfsError } from './errors.ts';
export { MemoryVfs } from './memory.ts';
export { OpfsVfs } from './opfs.ts';
export {
  joinPath,
  normalizePath,
  dirname,
  basename,
  extname,
  isAbsolute,
  segments,
} from './path.ts';
export {
  syncMirror,
  resetSyncMirror,
  setSyncMirror,
  setAsyncVfs,
  asyncVfs,
  installMemoryFs,
  createMemoryFs,
  MemoryFsSync,
} from './sync-mirror.ts';
export type { FsSync } from './sync-mirror.ts';
export { MemoryBackend } from './memory-backend.ts';
