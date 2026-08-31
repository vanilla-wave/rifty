import type { InstallResult } from '../../installer.ts';
import type { ShadowSubstitutionPlan } from './planner.ts';

const plans = new WeakMap<InstallResult, ShadowSubstitutionPlan>();

export function recordShadowSubstitutionPlanForInstallResult(
  result: InstallResult,
  plan: ShadowSubstitutionPlan,
): void {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted InstallResult shadow plan invariant failed');
  }
  plans.set(result, plan);
}

export function shadowSubstitutionPlanForInstallResult(
  result: InstallResult,
): ShadowSubstitutionPlan {
  const plan = plans.get(result);
  if (!plan) {
    throw new TypeError('InstallResult was not produced by the shadow-aware installer boundary');
  }
  return plan;
}
