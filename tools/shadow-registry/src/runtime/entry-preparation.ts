import type { FsSync } from '@riftydev/vfs';
import type { ShadowRuntimeTier } from '../internal/recipe-selection.ts';
import { clearRuntimeEsbuild, publishRuntimeEsbuildFailure } from './realm.ts';
import {
  ESBUILD_RUNTIME_ADAPTER_ID,
  type PackageRuntimeBinding,
  activatePackageRuntimeAdapters,
  assertPackageRuntimeBindings,
} from './runtime-adapters.ts';
import { planViteNodeEntryEdge as planNodeEntryIntegration } from './vite-node-entry-edge.ts';

/** Privileged generic entry preparation over strict ready bindings and adapter ids. */
export async function preparePackageEntryRuntime(
  options:
    | {
        readonly kind?: 'program';
        readonly runtimeTier?: ShadowRuntimeTier;
        readonly bin: boolean;
        readonly root: string;
        readonly args: readonly string[];
        readonly entryPath: string;
        readonly runtimeBindings: readonly PackageRuntimeBinding[];
        readonly fs: FsSync;
        readonly getCwd?: () => string;
        readonly refs?: { ref(): void; unref(): void };
      }
    | {
        readonly kind: 'eval';
        readonly runtimeTier?: ShadowRuntimeTier;
        readonly root: string;
        readonly runtimeBindings: readonly PackageRuntimeBinding[];
        readonly fs: FsSync;
        readonly getCwd?: () => string;
        readonly refs?: { ref(): void; unref(): void };
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
    // Bootstrap binding shape is an invariant; only activation failures defer to a consumer.
    assertPackageRuntimeBindings({
      bindings: options.runtimeBindings,
      cwd: options.root,
      runtimeTier: options.runtimeTier,
    });
    if (
      !options.runtimeBindings.some((binding) => binding.adapterId === ESBUILD_RUNTIME_ADAPTER_ID)
    ) {
      clearRuntimeEsbuild();
    }
    try {
      await activatePackageRuntimeAdapters({
        runtimeTier: options.runtimeTier,
        bindings: options.runtimeBindings,
        fs: options.fs,
        cwd: options.root,
        ...(options.getCwd === undefined ? {} : { getCwd: options.getCwd }),
        ...(options.refs === undefined ? {} : { refs: options.refs }),
      });
    } catch (error) {
      publishRuntimeEsbuildFailure(error);
    }
  }
  await integration.complete();
}
