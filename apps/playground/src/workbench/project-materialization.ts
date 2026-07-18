import type { InstallAcquisitionProvenance } from '@riftydev/npm-client';
import {
  ClosedHandleError,
  ProjectDefinitionMismatchError,
  type RuntimeAssetProgress,
} from './errors.ts';
import { createProjectAcquisitionWaiterScope } from './project-acquisition-waiters.ts';
import { type InspectedProjectDefinition, projectStorageSegment } from './project-definition.ts';

export { ClosedHandleError, ProjectDefinitionMismatchError } from './errors.ts';

export type ProjectFirstMaterialization =
  | { readonly kind: 'install' }
  | {
      readonly kind: 'snapshot';
      readonly snapshot: {
        readonly snapshotId: string;
        readonly assetUrl: string;
        readonly templateId: string;
      };
    };

export type ProjectAcquisitionProvenance =
  | { readonly outcome: 'existing'; readonly identity: string; readonly packages: number }
  | {
      readonly outcome: 'snapshot';
      readonly snapshotId: string;
      readonly identity: string;
      readonly packages: number;
    }
  | ({ readonly outcome: 'installed' } & InstallAcquisitionProvenance);

export interface ProjectSnapshotFailure {
  readonly snapshotId: string;
  readonly reason: string;
}

/** Owner-born package decision consumed once the default terminal exists. */
export type ProjectAcquisitionPlan =
  | { readonly kind: 'ready'; readonly provenance: ProjectAcquisitionProvenance }
  | { readonly kind: 'install'; readonly snapshotFailures: readonly ProjectSnapshotFailure[] };

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
  waitForDurability(input: {
    readonly projectKey: string;
    readonly revision: number;
  }): Promise<void>;
}

export interface ProjectAcquisitionRequest {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly definition: InspectedProjectDefinition;
}

export interface ProjectAcquisitionOptions {
  readonly onRuntimeAssetProgress?: (progress: RuntimeAssetProgress) => void;
}

export interface ProjectAcquisitionEnsureOptions extends ProjectAcquisitionOptions {
  /** Owner-local waiter lifetime; aborting it must not cancel another manager waiter. */
  readonly signal?: AbortSignal;
}

export interface ProjectAcquisitionPort<TAcquisition = unknown> {
  ensure(
    request: ProjectAcquisitionRequest,
    options?: ProjectAcquisitionEnsureOptions,
  ): Promise<TAcquisition>;
}

export interface ProjectMaterializerDependencies<TAcquisition = unknown> {
  readonly owner: ProjectMaterializationOwner;
  readonly acquisition: ProjectAcquisitionPort<TAcquisition>;
}

export interface MaterializedProject<TAcquisition = unknown> {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly acquisition: TAcquisition;
}

export interface ProjectMaterializer<TAcquisition = unknown> {
  open(
    definition: InspectedProjectDefinition,
    options?: ProjectAcquisitionOptions,
  ): Promise<MaterializedProject<TAcquisition>>;
  delete(id: string): Promise<void>;
  /** Owner-local shutdown fence; leaves the materializer reusable until close. */
  cancelActiveAcquisition(reason?: unknown): void;
  close(): Promise<void>;
}

export function createProjectMaterializer<TAcquisition>(
  dependencies: ProjectMaterializerDependencies<TAcquisition>,
): ProjectMaterializer<TAcquisition> {
  const { owner, acquisition } = dependencies;
  let closing = false;
  let closed = false;
  let operationTail = Promise.resolve();
  let closePromise: Promise<void> | null = null;
  const unresolvedStageCleanup = new Map<string, unknown>();
  const acquisitionWaiters = createProjectAcquisitionWaiterScope();

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

  const materializer: ProjectMaterializer<TAcquisition> = {
    open(definition, options) {
      return enqueue(async () => {
        const projectKey = definition.storageSegment;
        const existing = await owner.readProject(projectKey);
        throwIfClosing();

        let projectRoot: string;
        if (existing !== null) {
          if (existing.definitionIdentity !== definition.identity) {
            throw new ProjectDefinitionMismatchError(definition.id);
          }
          await owner.waitForDurability({ projectKey, revision: existing.revision });
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
            await owner.waitForDurability({ projectKey, revision: promoted.revision });
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

        const request = { projectKey, projectRoot, definition };
        let acquisitionResult: TAcquisition;
        try {
          acquisitionResult = await acquisitionWaiters.ensure(acquisition, request, {
            ...(options?.onRuntimeAssetProgress === undefined
              ? {}
              : { onRuntimeAssetProgress: options.onRuntimeAssetProgress }),
          });
        } catch (error) {
          if (closing || closed) {
            if (error instanceof ClosedHandleError) throw error;
            throw closedError(error);
          }
          throw error;
        }
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
        await owner.waitForDurability({ projectKey, revision });
        unresolvedStageCleanup.delete(projectKey);
      });
    },

    cancelActiveAcquisition(reason = closedError()) {
      acquisitionWaiters.cancel(reason);
    },

    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      acquisitionWaiters.cancel(closedError());
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
