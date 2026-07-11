/** Framework-free, browser-only workbench session controllers. */
export * from './config.ts';
export * from './project-catalog.ts';
export * from './project-spec.ts';
export {
  WORKBENCH_SINGLETON_ERROR,
  createWorkbenchSession,
  type WorkbenchControllers,
  type WorkbenchSession,
  type WorkbenchSessionSnapshot,
  type WorkbenchSessionStatus,
  type WorkbenchStorageSnapshot,
} from './session.ts';
export * from './controllers/editor.ts';
export * from './controllers/files.ts';
export * from './controllers/preview.ts';
export * from './controllers/terminal.ts';

// Lifted headless orchestration dogfooded by the Solid playground.
export * from './orchestration/dev-server-lifecycle.ts';
export * from './orchestration/editor-op-queue.ts';
export * from './orchestration/owner-file-read.ts';
export * from './orchestration/workspace-files.ts';

export {
  createTerminalManager,
  type TerminalDimensions,
  type TerminalManager,
  type TerminalManagerOptions,
  type TerminalRawInput,
  type TerminalRunDimensions,
  type TerminalSessionSnapshot,
  type TerminalStatus,
  type TerminalWriter,
} from './glue/terminal-manager.ts';
export {
  startWorkspaceOwner,
  wirePreviewBridge,
  type WorkspaceOwnerHandle,
  type WorkspaceOwnerOptions,
} from './glue/realVite.ts';
export {
  mountPlaygroundPreviewBridge,
  type PlaygroundPreviewBridgeOptions,
} from './glue/preview-bridge-wiring.ts';
export {
  probeStoragePersistence,
  type StoragePersistenceStatus,
} from './glue/storage-status.ts';
export {
  degradedBannerVisible,
  saveAffordance,
  storageModeFromBoot,
  statusStorageChip,
  type StorageMode,
} from './glue/degraded-storage.ts';
export { NodeModulesCache } from './glue/node-modules-cache.ts';
export { OwnerRpcFs } from './glue/owner-rpc-fs.ts';
export { SnapshotFs } from './glue/snapshot-fs.ts';
export {
  composeNodeModulesRows,
  fileCategory,
  readChildren,
  type NmNodeState,
  type NmRow,
  type TreeChild,
} from './glue/file-tree.ts';
export { looksBinary, type FsOpsTarget } from './glue/fs-ops.ts';
export {
  bridgeGitOwnerRpc,
  type GitOwnerClient,
} from './glue/git-owner-port.ts';
export { requestGitStatus, subscribeGitStatus } from './glue/git-status-feed.ts';
export { bridgeNodeModulesReads } from './glue/node-modules-port.ts';
export { buildDepSnapshot } from './glue/dep-snapshot.ts';
export { readEffectiveDeps } from './glue/install-stamp.ts';
export {
  bridgeProjectIndex,
  deleteProjectTree,
  markScratchDirtyIndex,
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndexPhases,
  setActiveIndex,
} from './glue/project-index-port.ts';
export {
  rootForId,
  type ActiveId,
  type Project,
  type ProjectIndex,
  type Scratch,
} from './glue/project-index.ts';
export { workspaceVfsPrefix } from './glue/scoped-vfs.ts';
export {
  requestVfsSnapshot,
  subscribeVfsSnapshot,
  type VfsSnapshotEntry,
  type VfsSnapshotFrame,
} from './glue/vfs-snapshot-port.ts';
export type { PreviewPortEntry } from './glue/pty-protocol.ts';
export {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
} from './glue/starter.ts';

// Host-owned worker extensions share the bundle-local Buffer repair with
// package-owned workers; exporting the chokepoint prevents a copy.
export { installBundleLocalBuffer } from './workers/worker-runtime-globals.ts';
