/** Vite-only host adapter for the framework-free workbench package. */
import {
  type ProjectSpec,
  type WorkspaceOwnerHandle as WorkbenchWorkspaceOwnerHandle,
  type WorkspaceOwnerOptions as WorkbenchWorkspaceOwnerOptions,
  startWorkspaceOwner as startWorkbenchWorkspaceOwner,
  wirePreviewBridge,
} from '@riftydev/workbench';
import { type TsLspOwnerChannel, attachTsLspOwnerChannel } from './ts-lsp-owner-adapter.ts';
import { PLAYGROUND_PROJECT_CATALOG } from './workbench-catalog.ts';
import { resolvePlaygroundWorkbenchConfig } from './workbench-host-config.ts';

export type WorkspaceOwnerHandle = WorkbenchWorkspaceOwnerHandle & TsLspOwnerChannel;
export { wirePreviewBridge };

export interface WorkspaceOwnerOptions
  extends Omit<WorkbenchWorkspaceOwnerOptions, 'assets' | 'catalog' | 'registry'> {
  readonly template?: ProjectSpec;
}

/**
 * Inject every Vite-resolved worker/WASM URL and deployment endpoint before
 * entering the package-owned owner orchestration.
 */
export function startWorkspaceOwner(opts: WorkspaceOwnerOptions = {}): WorkspaceOwnerHandle {
  const host = resolvePlaygroundWorkbenchConfig();
  return attachTsLspOwnerChannel(
    startWorkbenchWorkspaceOwner({
      ...opts,
      assets: host.assets,
      registry: host.registry,
      catalog: PLAYGROUND_PROJECT_CATALOG,
    }),
  );
}
