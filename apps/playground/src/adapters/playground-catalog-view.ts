import type { PlaygroundCatalogSnapshot } from '@riftydev/workbench/playground';
import type { ProjectIndex } from '../glue/project-index.ts';

export function catalogIndex(
  snapshot: PlaygroundCatalogSnapshot,
  hiddenProjectId?: string,
): ProjectIndex {
  return {
    activeId: snapshot.active?.kind === 'project' ? snapshot.active.id : ('scratch' as const),
    scratch:
      snapshot.scratch === null
        ? null
        : {
            starter: snapshot.scratch.starterId,
            dirty: snapshot.scratch.dirty,
            editedAt: snapshot.scratch.editedAt,
          },
    projects: snapshot.projects
      .filter((project) => project.id !== hiddenProjectId)
      .map((project) => ({
        id: project.id,
        name: project.name,
        starter: project.starterId,
        editedAt: project.editedAt,
      })),
  };
}
