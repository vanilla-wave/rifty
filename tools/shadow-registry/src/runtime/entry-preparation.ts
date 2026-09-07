import type { FsSync } from '@riftydev/vfs';
import { type PackageRuntimeBinding, activatePackageRuntimeAdapters } from './runtime-adapters.ts';
import { planViteNodeEntryEdge as planNodeEntryIntegration } from './vite-node-entry-edge.ts';

/** Privileged generic entry preparation over strict ready bindings and adapter ids. */
export async function preparePackageEntryRuntime(
  options:
    | {
        readonly kind?: 'program';
        readonly bin: boolean;
        readonly root: string;
        readonly args: readonly string[];
        readonly entryPath: string;
        readonly runtimeBindings: readonly PackageRuntimeBinding[];
        readonly fs: FsSync;
        readonly trackKeepalivePromise?: (promise: PromiseLike<unknown>) => void;
      }
    | {
        readonly kind: 'eval';
        readonly root: string;
        readonly runtimeBindings: readonly PackageRuntimeBinding[];
        readonly fs: FsSync;
        readonly trackKeepalivePromise?: (promise: PromiseLike<unknown>) => void;
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
    await activatePackageRuntimeAdapters({
      bindings: options.runtimeBindings,
      fs: options.fs,
      cwd: options.root,
    });
  }
  await integration.complete();
}
