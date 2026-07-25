import type { InstallResult } from '../../installer.ts';
import type { ShadowAssetPlan } from './planner.ts';

const plans = new WeakMap<InstallResult, ShadowAssetPlan>();

export function recordShadowAssetPlanForInstallResult(
  result: InstallResult,
  plan: ShadowAssetPlan,
): void {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted InstallResult shadow plan invariant failed');
  }
  plans.set(result, plan);
}

export function shadowAssetPlanForInstallResult(result: InstallResult): ShadowAssetPlan {
  const plan = plans.get(result);
  if (!plan) {
    throw new TypeError('InstallResult was not produced by the shadow-aware installer boundary');
  }
  return plan;
}
