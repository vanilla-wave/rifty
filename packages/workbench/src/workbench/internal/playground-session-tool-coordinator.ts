import type {
  ProjectDocumentsController,
  ProjectDocumentsOwnerByteScope,
  ProjectDocumentsRevision,
} from '../project-documents.ts';
import type { PlaygroundScm } from './playground-scm.ts';

interface DestructiveToolResult {
  readonly revision: ProjectDocumentsRevision;
}

export type PlaygroundScmBackend = Pick<
  PlaygroundScm,
  'snapshot' | 'subscribe' | 'refresh' | 'diff' | 'stage' | 'unstage' | 'commit'
> & {
  discard(path: string): Promise<DestructiveToolResult>;
};

export interface PlaygroundArchiveBackend {
  export(): Promise<string>;
  import(archiveJson: string): Promise<DestructiveToolResult>;
}

export interface PlaygroundArchiveTool {
  export(): Promise<string>;
  import(archiveJson: string): Promise<void>;
}

export interface PlaygroundScmArchiveTools {
  readonly scm: PlaygroundScm;
  readonly archive: PlaygroundArchiveTool;
}

export interface PlaygroundScmArchiveToolOptions {
  readonly documents: Pick<ProjectDocumentsController, 'awaitOwnerByteAdmission' | 'invalidate'>;
  readonly scm: PlaygroundScmBackend;
  readonly archive: PlaygroundArchiveBackend;
}

/** One Documents admission chokepoint for every owner-byte SCM/archive sibling. */
export function createPlaygroundScmArchiveTools(
  options: PlaygroundScmArchiveToolOptions,
): PlaygroundScmArchiveTools {
  const admit = async <Result>(
    scope: ProjectDocumentsOwnerByteScope,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    await options.documents.awaitOwnerByteAdmission(scope);
    return operation();
  };
  const pathScope = (path: string): ProjectDocumentsOwnerByteScope => ({ kind: 'path', path });
  const projectScope: ProjectDocumentsOwnerByteScope = Object.freeze({ kind: 'project' });

  const scm: PlaygroundScm = {
    snapshot: () => options.scm.snapshot(),
    subscribe: (listener) => options.scm.subscribe(listener),
    refresh: () => options.scm.refresh(),
    diff: (change) => admit(pathScope(change.path), () => options.scm.diff(change)),
    stage: (path) => admit(pathScope(path), () => options.scm.stage(path)),
    unstage: (path) => admit(pathScope(path), () => options.scm.unstage(path)),
    async discard(path) {
      const result = await admit(pathScope(path), () => options.scm.discard(path));
      options.documents.invalidate({ kind: 'reset', rootPath: path }, result.revision);
    },
    commit: (message) => admit(projectScope, () => options.scm.commit(message)),
  };
  Object.freeze(scm);

  const archive: PlaygroundArchiveTool = {
    export: () => admit(projectScope, () => options.archive.export()),
    async import(archiveJson) {
      const result = await admit(projectScope, () => options.archive.import(archiveJson));
      options.documents.invalidate({ kind: 'reset', rootPath: '/' }, result.revision);
    },
  };
  Object.freeze(archive);

  return Object.freeze({ scm, archive });
}
