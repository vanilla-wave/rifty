import { pinnedEntryForParent } from '../../installer-lockfile-reader.ts';
import type { InstallResult } from '../../installer.ts';
import { companionRequestsFor } from '../../shadow-shims.ts';
import type { ShadowSubstitutionPlan } from './planner.ts';

const facts = new WeakMap<
  InstallResult,
  {
    readonly plan: ShadowSubstitutionPlan;
    readonly companionPaths: readonly string[];
  }
>();

export function recordShadowSubstitutionPlanForInstallResult(
  result: InstallResult,
  plan: ShadowSubstitutionPlan,
  companionOnlyInstallPaths: ReadonlySet<string>,
): void {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted InstallResult shadow plan invariant failed');
  }
  const companionPaths = new Set<string>();
  for (const parent of result.packages) {
    const parentPath = parent.installPath ?? `node_modules/${parent.name}`;
    for (const [name, version] of Object.entries(
      companionRequestsFor(parent.name, parent.version),
    )) {
      const hit = pinnedEntryForParent(result.lockfile, name, parentPath);
      if (hit?.entry.version === version && companionOnlyInstallPaths.has(hit.installPath)) {
        companionPaths.add(hit.installPath);
      }
    }
  }
  facts.set(result, { plan, companionPaths: Object.freeze([...companionPaths]) });
}

export function shadowSubstitutionPlanForInstallResult(
  result: InstallResult,
): ShadowSubstitutionPlan {
  const installed = facts.get(result);
  if (!installed) {
    throw new TypeError('InstallResult was not produced by the shadow-aware installer boundary');
  }
  return installed.plan;
}

/** Actual scoped declaration AND no ordinary demand; never infer permission from a name. */
export function companionInstallPathsForInstallResult(result: InstallResult): readonly string[] {
  const installed = facts.get(result);
  if (!installed) {
    throw new TypeError('InstallResult was not produced by the shadow-aware installer boundary');
  }
  return installed.companionPaths;
}
