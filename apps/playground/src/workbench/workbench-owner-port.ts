import { NotImplementedError } from '@riftydev/vfs';
import type { OwnerStoragePersistence, OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import type { InspectedProjectDefinition } from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';

export interface WorkbenchOwnerStartInput {
  readonly deployment: {
    readonly workers: {
      readonly owner: string;
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
    };
    readonly wasm: {
      readonly sqlite: string;
      readonly esbuild: string;
    };
    readonly previewProbeTimeoutMs: number;
  };
  readonly packageAcquisition: {
    readonly registryUrl: string;
    readonly eddy?: {
      readonly resolverUrl: string;
      readonly bundleBaseUrl: string;
      readonly presetPins: Readonly<Record<string, string>>;
    };
  };
  readonly storage: { readonly persistence: OwnerStoragePersistence };
}

/** Physical worker handle; the adapter owns it until fully closed. */
export interface RawWorkspaceOwnerHandle {
  readonly ready: Promise<void>;
  readonly closed: Promise<unknown>;
  storageSnapshot(): unknown;
  openProject<TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  close(): void;
}

/** Semantic owner surface used directly by the public Workbench facade. */
export interface WorkbenchOwnerHandle {
  openProject<TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  /** Stable/idempotent; settles only after the physical owner has exited. */
  close(): Promise<void>;
}

export interface WorkbenchOwnerStartResult {
  readonly owner: WorkbenchOwnerHandle;
  readonly storage: OwnerStorageSnapshot;
}

export interface WorkbenchOwnerPort {
  start(input: WorkbenchOwnerStartInput): Promise<WorkbenchOwnerStartResult>;
}

/** Worker/process creation is the external effect boundary injected in tests. */
export interface WorkbenchOwnerPortDependencies {
  startWorkspaceOwner(input: WorkbenchOwnerStartInput): RawWorkspaceOwnerHandle;
}

export function createWorkbenchOwnerPort(
  _dependencies: WorkbenchOwnerPortDependencies,
): WorkbenchOwnerPort {
  return Object.freeze({
    async start(_input: WorkbenchOwnerStartInput): Promise<WorkbenchOwnerStartResult> {
      throw new NotImplementedError(
        'workbench.owner.start',
        'Contract+RED: owner startup lifecycle is not implemented',
      );
    },
  });
}
