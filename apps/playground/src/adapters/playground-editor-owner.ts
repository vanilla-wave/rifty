import type { ProjectFiles } from '@riftydev/workbench';
import type { EditorApi, EditorDocumentEvent } from '../components/editor-host-core.ts';
import type {
  PlaygroundDocumentWriter,
  PlaygroundProjectMirror,
} from './playground-project-view.ts';

/** Existing Document FIFO owns replacement; Monaco alone decides whether its buffer is clean. */
export function bindPlaygroundEditorOwner(options: {
  readonly api: EditorApi;
  readonly files: ProjectFiles;
  readonly mirror: PlaygroundProjectMirror;
  readonly documents: PlaygroundDocumentWriter;
  readonly isCurrent: () => boolean;
  readonly onDocument: (event: EditorDocumentEvent) => void;
  readonly onError: (message: string) => void;
}): () => void {
  const refresh = (path: string) => {
    if (!options.isCurrent()) return;
    void options.documents
      .refresh(
        path,
        () => options.mirror.version(path),
        (snapshot) => {
          if (!options.isCurrent()) return false;
          const bytes = options.mirror.admitFile(snapshot);
          return options.api.applyOwnerBytes(path, bytes);
        },
      )
      .catch((error: unknown) => {
        if (options.isCurrent())
          options.onError(
            `Editor refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
  };
  const stopFiles = options.files.subscribe(() => {
    for (const path of options.api.openPathsUnder('/')) refresh(path);
  });
  const stopDocuments = options.api.onDocument((event) => {
    options.onDocument(event);
    if (event.kind === 'open') refresh(event.path);
  });
  return () => {
    stopFiles();
    stopDocuments();
  };
}
