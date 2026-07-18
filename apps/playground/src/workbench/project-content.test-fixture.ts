import { createVfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import { SnapshotFs } from './internal/snapshot-fs.ts';
import { createProjectContentController } from './project-content.ts';
import type { ProjectDocuments } from './project-documents.ts';
import type { ProjectFiles } from './project-files.ts';

/** Real content composition whose owner I/O boundary fails loudly when unexpectedly used. */
export function createUnusedProjectContent(label: string) {
  const projectRoot = `/.rifty/workbench/projects/${label}`;
  const snapshots = new SnapshotFs(projectRoot);
  const committer = createVfsCommitCoordinator({
    captureOwner() {
      throw new Error(`${label} did not expect a project content commit`);
    },
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: 1_000,
  });
  return createProjectContentController({
    projectRoot,
    snapshots,
    committer,
    readVersionedFile: async () => {
      throw new Error(`${label} did not expect a project file read`);
    },
    readVersionedDirectory: async () => {
      throw new Error(`${label} did not expect a project directory read`);
    },
  });
}

function unexpectedHandleUse(label: string, method: string): never {
  throw new Error(`${label}.${method} is outside this owner-boundary test`);
}

/** Explicit external-owner boundary for tests that never exercise project content. */
export function createUnusedOwnerProjectHandles(label: string): {
  readonly files: ProjectFiles;
  readonly documents: ProjectDocuments;
} {
  const files = Object.freeze({
    readFile: () => unexpectedHandleUse(label, 'files.readFile'),
    readdir: () => unexpectedHandleUse(label, 'files.readdir'),
    writeFile: () => unexpectedHandleUse(label, 'files.writeFile'),
    mkdir: () => unexpectedHandleUse(label, 'files.mkdir'),
    rename: () => unexpectedHandleUse(label, 'files.rename'),
    remove: () => unexpectedHandleUse(label, 'files.remove'),
    snapshot: () => unexpectedHandleUse(label, 'files.snapshot'),
    subscribe: () => unexpectedHandleUse(label, 'files.subscribe'),
  }) satisfies ProjectFiles;
  const documents = Object.freeze({
    open: () => unexpectedHandleUse(label, 'documents.open'),
  }) satisfies ProjectDocuments;
  return Object.freeze({ files, documents });
}
