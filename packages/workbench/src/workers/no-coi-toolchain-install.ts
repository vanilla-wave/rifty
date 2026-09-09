import { RegistryClient, install } from '@riftydev/npm-client';
import { shadowSubstitutionPlanForInstallResult } from '@riftydev/npm-client/internal';
import type { ToolchainInstallRequest } from '@riftydev/runtime-js/internal';
import { type Vfs, normalizePath, syncMirror } from '@riftydev/vfs';
import { finalizeGenericPackageInstallFiles } from './package-install-generic-finalizer.ts';
import {
  type WorkbenchRuntimeBinding,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

export { activateWorkbenchRuntimeAdapters };

/** First-use package acquisition and activation; worker owns admission and snapshots. */
export async function installToolchainPackages(
  input: ToolchainInstallRequest,
  vfs: Vfs,
): Promise<{ readonly bindings: readonly WorkbenchRuntimeBinding[]; readonly packages: number }> {
  const registry = new RegistryClient({ baseUrl: input.registryUrl });
  const result = await install({
    vfs,
    cwd: input.cwd,
    registry,
  });
  finalizeGenericPackageInstallFiles({ root: input.cwd });
  const bindings: readonly WorkbenchRuntimeBinding[] = Object.freeze(
    shadowSubstitutionPlanForInstallResult(result).bindings.map((binding) =>
      Object.freeze({
        adapterId: binding.adapterId,
        packagePath: normalizePath(`${input.cwd}/${binding.packagePath}`),
      }),
    ),
  );
  await activateWorkbenchRuntimeAdapters({ bindings, fs: syncMirror(), cwd: input.cwd });
  return { bindings, packages: result.packages.length };
}
