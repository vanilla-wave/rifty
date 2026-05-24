/**
 * Re-export of the VFS sync mirror so the rest of the `fs` builtin can keep
 * its existing relative imports. The actual implementation now lives in
 * `@rifty/vfs` so both runtime-js and runtime-wasi share one source of truth
 * without one runtime depending on the other (see CLAUDE.md layering rules).
 */
export {
  syncMirror,
  resetSyncMirror,
  setSyncMirror,
  MemoryFsSync,
  joinPath,
} from '@rifty/vfs';
export type { FsSync } from '@rifty/vfs';
