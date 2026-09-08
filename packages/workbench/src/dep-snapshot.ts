export {
  DepSnapshotFetchError,
  buildDepSnapshot,
  createDepSnapshotMemoryFs,
  fetchDepSnapshot,
  fetchVerifiedDepSnapshot,
  parseDepSnapshot,
  produceDepSnapshot,
  restoreDepSnapshot,
  serializeDepSnapshot,
  serializeDepSnapshotTar,
  snapshotIdFromBytes,
  verifyDepSnapshotReplayCache,
} from './glue/dep-snapshot.ts';
export type {
  DepSnapshotFetchStage,
  DepSnapshotV3,
  PreparedDepSnapshotRestore,
  ProduceDepSnapshotInput,
  ProduceDepSnapshotResult,
  VerifiedDepSnapshot,
} from './glue/dep-snapshot.ts';
export { installArtifactIdentity } from './glue/install-artifact-identity.ts';
