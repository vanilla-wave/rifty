import type { ChildFsArtifact } from './child-fs-artifact.mjs';
import type { ChildFsCliOptions } from './child-fs-runner.mjs';

export interface ChildFsOrchestratorOptions extends ChildFsCliOptions {
  readonly generatedAt: string;
  readonly gitSha: string;
}

export interface ChildFsServerHandle {
  readonly ready: Promise<unknown>;
  readonly failed: Promise<never>;
  readonly closed: Promise<unknown>;
  readonly close: () => Promise<unknown>;
  readonly forceClose: () => Promise<unknown>;
}

export interface ChildFsBrowserHandle {
  readonly version: string;
  readonly failed: Promise<never>;
  readonly closed: Promise<unknown>;
  readonly runSample: (lane: 'product-coi' | 'in-realm', ordinal: number) => Promise<unknown>;
  readonly close: () => Promise<unknown>;
  readonly forceClose: () => Promise<unknown>;
}

export interface ChildFsOrchestratorActions {
  readonly startServer: (port: number) => Promise<ChildFsServerHandle>;
  readonly launchBrowser: (baseUrl: string) => Promise<ChildFsBrowserHandle>;
  readonly publish: (path: string, json: string) => unknown;
}

export interface ChildFsDeadlineOptions {
  readonly serverReadyMs?: number;
  readonly sampleMs?: number;
  readonly cleanupMs?: number;
}

export const CHILD_FS_DEADLINES: Readonly<Required<ChildFsDeadlineOptions>>;
export function orchestrateChildFs(
  options: ChildFsOrchestratorOptions,
  actions: ChildFsOrchestratorActions,
  deadlineOverrides?: ChildFsDeadlineOptions,
): Promise<ChildFsArtifact>;
