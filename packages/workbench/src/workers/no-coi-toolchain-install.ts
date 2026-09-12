import { RegistryClient, install } from '@riftydev/npm-client';
import {
  planShadowSubstitutionsFromLockfile,
  shadowSubstitutionPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import type { ToolchainInstallRequest } from '@riftydev/runtime-js/internal';
import { preparePackageEntryRuntime } from '@riftydev/shadow-registry/runtime';
import { type Vfs, normalizePath, syncMirror } from '@riftydev/vfs';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';
import {
  type WorkbenchRuntimeBinding,
  activateWorkbenchRuntimeAdapters,
  workbenchRuntimeAdapterOwnership,
} from './workbench-runtime-adapters.ts';

export { activateWorkbenchRuntimeAdapters };

/** Saved files remain accessible; invalid lock grants no adapter capability. */
export async function prepareSavedToolchain(cwd: string) {
  let bindings: readonly WorkbenchRuntimeBinding[] = [];
  try {
    const plan = planShadowSubstitutionsFromLockfile(
      JSON.parse(
        new TextDecoder().decode(syncMirror().readFileBytesSync(`${cwd}/package-lock.json`)),
      ),
    );
    bindings = Object.freeze(
      plan.bindings.map((binding) =>
        Object.freeze({
          adapterId: binding.adapterId,
          packagePath: `${cwd}/${binding.packagePath}`,
        }),
      ),
    );
  } catch {
    // A missing/invalid lock is not installation admission (ADR-0417).
  }
  await preparePackageEntryRuntime({
    kind: 'eval',
    root: cwd,
    runtimeBindings: bindings,
    fs: syncMirror(),
    ...workbenchRuntimeAdapterOwnership(),
  });
  return bindings;
}

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
  await finalizePackageInstallFiles({ root: input.cwd });
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
