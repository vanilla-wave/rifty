import { createBrowserOpenWorkbench } from './internal/browser-workbench-composition.ts';

export {
  ClosedHandleError,
  DirtyProjectDocumentError,
  FileConflictError,
  ProjectBusyError,
  ProjectDefinitionMismatchError,
  ProjectDocumentSaveInProgressError,
  ProjectFileOperationError,
  ProjectRunExitedBeforeReadyError,
  RuntimeAssetError,
  StaleProjectDocumentError,
  StdinClosedError,
  WorkbenchOriginOccupiedError,
} from './errors.ts';
export type {
  FileConflictDetails,
  ProjectDocumentInvalidation,
  ProjectFileEntry,
  ProjectFileOperation,
  ProjectFileOperationFailure,
  ProjectMutationOutcome,
  RuntimeAssetCacheInspection,
  RuntimeAssetFailure,
  RuntimeAssetFailurePhase,
  RuntimeAssetProgress,
  RuntimeAssetRecovery,
  RuntimeAssetStorageClass,
} from './errors.ts';
export type {
  WorkbenchHealth,
  WorkbenchHealthIssue,
  WorkbenchHealthSnapshot,
  WorkbenchRecoveryScope,
} from './health.ts';
export type {
  StoragePersistence,
  Workbench,
  WorkbenchOptions,
  WorkbenchProjectOpenOptions,
  WorkbenchSnapshot,
  WorkbenchStorageSnapshot,
  WorkbenchRuntimeAssets,
} from './open-workbench.ts';
export type { PreviewHandle } from './preview-readiness.ts';
export { projects } from './project-definition.ts';
export type { ProjectDefinition } from './project-definition.ts';
export type {
  ProjectDocument,
  ProjectDocumentCloseOptions,
  ProjectDocumentConflict,
  ProjectDocuments,
  ProjectDocumentSnapshot,
} from './project-documents.ts';
export type {
  ProjectFileMutationResult,
  ProjectFileRead,
  ProjectFiles,
  ProjectFilesSnapshot,
  ProjectMkdirOptions,
  ProjectRemoveOptions,
  ProjectRenameOptions,
  ProjectWriteFileOptions,
} from './project-files.ts';
export type { ProjectRun, ProjectSession } from './project-session.ts';
export type {
  ProjectTerminal,
  ProjectTerminalRun,
  ProjectTerminalSnapshot,
} from './project-terminal.ts';

/** Public browser composition; deployment assets remain explicit caller input. */
export const openWorkbench = createBrowserOpenWorkbench();
