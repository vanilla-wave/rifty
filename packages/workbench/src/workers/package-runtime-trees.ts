import {
  type ShadowSubstitutionPlan,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from '@riftydev/npm-client/internal';
import { normalizePath } from '@riftydev/vfs';
import type {
  PackageAcquisitionAdapter,
  PackageAcquisitionProject,
} from './package-acquisition-types.ts';

export type PublishedPackageTree =
  | Readonly<{
      kind: 'installed';
      project: PackageAcquisitionProject;
      packageJsonText: string;
      plan: ShadowSubstitutionPlan;
      /** A manifest-only edit preserves the live tree, not its durable install claim. */
      proof: 'claim' | 'owner-runtime';
    }>
  | Readonly<{
      kind: 'empty';
      project: PackageAcquisitionProject;
      packageJsonText: string;
      plan: ShadowSubstitutionPlan;
    }>
  | Readonly<{ kind: 'saved'; project: PackageAcquisitionProject; plan: ShadowSubstitutionPlan }>;

export type PublishedPackageTreeEntry = readonly [root: string, tree: PublishedPackageTree];

export async function composePackageTreeAncestry(
  ancestry: readonly PublishedPackageTreeEntry[],
): Promise<
  Readonly<{
    plan: ShadowSubstitutionPlan;
    runtimeBindings: readonly Readonly<{ adapterId: string; packagePath: string }>[];
  }>
> {
  const substitutions: ShadowSubstitutionPlan['substitutions'][number][] = [];
  const claimedInstallPaths = new Set<string>();
  const claimedAdapters = new Set<string>();
  const runtimeBindings: Array<Readonly<{ adapterId: string; packagePath: string }>> = [];
  for (const [root, published] of ancestry) {
    for (const binding of published.plan.bindings) {
      if (claimedAdapters.has(binding.adapterId)) continue;
      claimedAdapters.add(binding.adapterId);
      runtimeBindings.push(
        Object.freeze({
          adapterId: binding.adapterId,
          packagePath: normalizePath(`${root}/${binding.packagePath}`),
        }),
      );
    }
    for (const substitution of published.plan.substitutions) {
      const installPath = substitution.materialization.installPath;
      if (claimedInstallPaths.has(installPath)) continue;
      claimedInstallPaths.add(installPath);
      substitutions.push(substitution);
    }
  }

  const nearest = ancestry[0];
  if (nearest === undefined) throw new Error('package tree ancestry is empty');
  const exactPublished = ancestry.find(
    ([, published]) =>
      published.plan.substitutions.length === substitutions.length &&
      published.plan.substitutions.every(
        (substitution, index) => substitution === substitutions[index],
      ),
  )?.[1];
  const plan =
    exactPublished?.plan ??
    (substitutions.length === 0 ? nearest[1].plan : planAppliedShadowSubstitutions(substitutions));
  return Object.freeze({ plan, runtimeBindings: Object.freeze(runtimeBindings) });
}

export async function readSavedPackageTree(
  project: PackageAcquisitionProject,
  adapter: PackageAcquisitionAdapter,
): Promise<PublishedPackageTree> {
  let plan: ShadowSubstitutionPlan;
  try {
    plan = planShadowSubstitutionsFromLockfile(await adapter.readPackageLock?.(project));
  } catch {
    // Unusable optional adapter metadata grants no bindings. Its consumer remains a loud failure.
    plan = planAppliedShadowSubstitutions([]);
  }
  return Object.freeze({ kind: 'saved', project, plan });
}
