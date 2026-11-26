export * from './shadow/index.ts';
export { readExistingLockfile } from '../installer-lockfile-reader.ts';
export { lockfileRootMatchesRequest } from '../installer-lockfile-replay.ts';
export {
  DEP_SNAPSHOT_TAR_BLOCK,
  type DepSnapshotTarEntry,
  depSnapshotTarChecksum,
  failDepSnapshotTar,
  readDepSnapshotManifest,
  readDepSnapshotTar,
  validateDepSnapshotEntries,
} from '../dep-snapshot-envelope.ts';
