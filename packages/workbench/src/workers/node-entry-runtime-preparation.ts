import type { FsSync } from '@riftydev/vfs';
import { planViteNodeEntryEdge as planNodeEntryIntegration } from './vite-node-entry-edge.ts';
import {
  type WorkbenchRuntimeBinding,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

/** Privileged generic entry preparation over strict ready bindings and adapter ids. */
export async function prepareNodeEntryRuntime(
  options:
    | {
        readonly kind?: 'program';
        readonly bin: boolean;
        readonly root: string;
        readonly args: readonly string[];
        readonly entryPath: string;
        readonly runtimeBindings: readonly WorkbenchRuntimeBinding[];
        readonly fs: FsSync;
      }
    | {
        readonly kind: 'eval';
        readonly root: string;
        readonly runtimeBindings: readonly WorkbenchRuntimeBinding[];
        readonly fs: FsSync;
      },
): Promise<void> {
  const integration =
    options.kind === 'eval'
      ? {
          activateRuntimeAdapters: true,
          complete: async () => {},
        }
      : planNodeEntryIntegration(options);
  if (integration.activateRuntimeAdapters) {
    await activateWorkbenchRuntimeAdapters({
      bindings: options.runtimeBindings,
      fs: options.fs,
      cwd: options.root,
    });
  }
  await integration.complete();
}
