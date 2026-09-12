import type { InstallAcquisitionProvenance } from '@riftydev/npm-client';
import { ClosedHandleError, ProjectDefinitionMismatchError } from './errors.ts';
import { type InspectedProjectDefinition, projectStorageSegment } from './project-definition.ts';

export { ClosedHandleError, ProjectDefinitionMismatchError } from './errors.ts';

export type ProjectSnapshotApplication =
  | { readonly mode: 'initial-deployment-only' }
  | { readonly mode: 'apply-snapshot'; readonly conflict: 'error' | 'overwrite' };

export function normalizeProjectSnapshotApplication(value: unknown): ProjectSnapshotApplication {
  if (value === undefined) return Object.freeze({ mode: 'initial-deployment-only' });
  const invalid = (): never => {
    throw new TypeError('Invalid snapshot application policy');
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (key !== 'mode' && key !== 'conflict')) return invalid();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !('value' in property)) return invalid();
    properties[key] = property.value;
  }
  if (properties.mode === 'initial-deployment-only' && !Object.hasOwn(properties, 'conflict')) {
    return Object.freeze({ mode: 'initial-deployment-only' });
  }
  if (properties.mode !== 'apply-snapshot') return invalid();
  const conflict = Object.hasOwn(properties, 'conflict') ? properties.conflict : 'error';
  if (conflict !== 'error' && conflict !== 'overwrite') return invalid();
  return Object.freeze({ mode: 'apply-snapshot', conflict });
}

export type ProjectFirstMaterialization =
  | { readonly kind: 'install' }
  | {
      readonly kind: 'snapshot';
      readonly application?: ProjectSnapshotApplication;
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
  | { readonly kind: 'saved' }
  | { readonly kind: 'ready'; readonly provenance: ProjectAcquisitionProvenance }
  | { readonly kind: 'install'; readonly snapshotFailures: readonly ProjectSnapshotFailure[] };

export type ProjectSnapshotAdmission =
  | { readonly mode: 'saved' }
  | {
      readonly mode: 'initial' | 'apply';
      readonly preflightRoot?: string;
      readonly transaction: (
        operation: () => Promise<ProjectAcquisitionPlan>,
        reconcileRollback: () => Promise<void>,
      ) => Promise<ProjectAcquisitionPlan>;
    };

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
  readonly snapshotAdmission?: ProjectSnapshotAdmission;
}

export interface ProjectAcquisitionPort<TAcquisition = unknown> {
  ensure(request: ProjectAcquisitionRequest): Promise<TAcquisition>;
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
  open(definition: InspectedProjectDefinition): Promise<MaterializedProject<TAcquisition>>;
  delete(id: string): Promise<void>;
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
