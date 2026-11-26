/**
 * The consumer realm's copy of the guest FS and its snapshot codec (ADR-0567,
 * ADR-0568 §2): built to `dist/codec.js` by `scripts/build-runtime.mjs`, so the
 * packed host carries it with no `@riftydev/*` dependency.
 */
export { MemoryFsSync } from '@riftydev/vfs/internal';
export {
  FsSnapshotError,
  GUEST_DIRS,
  restoreFs,
  snapshotBudget,
  snapshotFs,
} from '@riftydev/isolate-guest';
export { readDepSnapshotManifest, readDepSnapshotTar } from '@riftydev/npm-client/internal';
