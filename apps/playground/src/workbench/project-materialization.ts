import { ClosedHandleError, ProjectDefinitionMismatchError } from './errors.ts';
import { type InspectedProjectDefinition, projectStorageSegment } from './project-definition.ts';

export { ClosedHandleError, ProjectDefinitionMismatchError } from './errors.ts';

export interface ProjectMaterializationRecord {
  readonly definitionIdentity: string;
  readonly projectRoot: string;
  readonly revision: number;
}

export interface ProjectMaterializationOwner {
  readProject(projectKey: string): Promise<ProjectMaterializationRecord | null>;
  discardStage(projectKey: string): Promise<void>;
  beginStage(projectKey: string): Promise<{ readonly stageId: string }>;
  writeStageFile(stageId: string, path: string, bytes: Uint8Array): Promise<void>;
  promoteStage(input: {
    readonly stageId: string;
    readonly projectKey: string;
    readonly definitionIdentity: string;
  }): Promise<{ readonly projectRoot: string; readonly revision: number }>;
  deleteProject(projectKey: string): Promise<{ readonly revision: number }>;
  waitForDurability(revision: number): Promise<void>;
}

export interface ProjectAcquisitionRequest {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly definition: InspectedProjectDefinition;
}

export interface ProjectAcquisitionPort {
  ensure(request: ProjectAcquisitionRequest): Promise<unknown>;
}

export interface ProjectMaterializerDependencies {
  readonly owner: ProjectMaterializationOwner;
  readonly acquisition: ProjectAcquisitionPort;
}

export interface MaterializedProject {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly acquisition: unknown;
}

export interface ProjectMaterializer {
  open(definition: InspectedProjectDefinition): Promise<MaterializedProject>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

export function createProjectMaterializer(
  dependencies: ProjectMaterializerDependencies,
): ProjectMaterializer {
  const { owner, acquisition } = dependencies;
  let closing = false;
  let closed = false;
  let operationTail = Promise.resolve();
  let closePromise: Promise<void> | null = null;
  const unresolvedStageCleanup = new Map<string, unknown>();

  const closedError = (cause?: unknown): ClosedHandleError =>
    new ClosedHandleError('Project materializer', cause);

  const throwIfClosing = (): void => {
    if (closing || closed) throw closedError();
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closing || closed) return Promise.reject(closedError());
    const result = operationTail.then(async () => {
      throwIfClosing();
      return operation();
    });
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const materializer: ProjectMaterializer = {
    open(definition) {
      return enqueue(async () => {
        const projectKey = definition.storageSegment;
        const existing = await owner.readProject(projectKey);
        throwIfClosing();

        let projectRoot: string;
        if (existing !== null) {
          if (existing.definitionIdentity !== definition.identity) {
            throw new ProjectDefinitionMismatchError(definition.id);
          }
          await owner.waitForDurability(existing.revision);
          throwIfClosing();
          projectRoot = existing.projectRoot;
        } else {
          await owner.discardStage(projectKey);
          unresolvedStageCleanup.delete(projectKey);
          throwIfClosing();

          const { stageId } = await owner.beginStage(projectKey);
          let pendingStage = true;
          try {
            if (closing || closed) {
              throw closedError();
            }

            for (const path of Object.keys(definition.files).sort()) {
              const bytes = definition.files[path];
              if (bytes === undefined) continue;
              await owner.writeStageFile(stageId, path, bytes.slice());
              if (closing || closed) {
                throw closedError();
              }
            }

            const promoted = await owner.promoteStage({
              stageId,
              projectKey,
              definitionIdentity: definition.identity,
            });
            pendingStage = false;
            projectRoot = promoted.projectRoot;
            await owner.waitForDurability(promoted.revision);
            throwIfClosing();
          } catch (error) {
            if (pendingStage) {
              try {
                await owner.discardStage(projectKey);
                unresolvedStageCleanup.delete(projectKey);
                pendingStage = false;
              } catch (cleanupError) {
                unresolvedStageCleanup.set(projectKey, cleanupError);
                const combined = new AggregateError(
                  [error, cleanupError],
                  'Project materializer could not discard its interrupted stage',
                );
                if (closing || closed) throw closedError(combined);
                throw combined;
              }
            }
            if (closing || closed) {
              if (error instanceof ClosedHandleError) throw error;
              throw closedError(error);
            }
            throw error;
          }
        }

        const acquisitionResult = await acquisition.ensure({
          projectKey,
          projectRoot,
          definition,
        });
        throwIfClosing();
        return Object.freeze({
          projectKey,
          projectRoot,
          acquisition: acquisitionResult,
        });
      });
    },

    delete(id) {
      let projectKey: string;
      try {
        projectKey = projectStorageSegment(id);
      } catch (error) {
        return Promise.reject(error);
      }
      return enqueue(async () => {
        const { revision } = await owner.deleteProject(projectKey);
        await owner.waitForDurability(revision);
        unresolvedStageCleanup.delete(projectKey);
      });
    },

    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = operationTail.then(() => {
        closed = true;
        const failures = [...unresolvedStageCleanup.values()];
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            'Project materializer could not discard interrupted stages',
          );
        }
      });
      return closePromise;
    },
  };

  return materializer;
}
