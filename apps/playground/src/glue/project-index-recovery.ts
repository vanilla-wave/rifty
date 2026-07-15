import { type VfsMutationGuard, guardVfsMutations } from '@riftydev/vfs';
import {
  type IndexFs,
  type ProjectIndex,
  type ProjectIndexRecoveryPlan,
  applyProjectIndexRecoveryDeletion,
  applyProjectIndexRecoverySynthesis,
} from './project-index.ts';

/** Apply a pure recovery plan through the owner's package-state policy boundary. */
export async function applyGuardedProjectIndexRecovery(
  fs: IndexFs,
  plan: ProjectIndexRecoveryPlan,
  guard: VfsMutationGuard,
): Promise<ProjectIndex> {
  for (const deletion of plan.deletions) {
    await guardVfsMutations(guard, [{ kind: 'rm', path: deletion.root }], () => {
      applyProjectIndexRecoveryDeletion(fs, deletion);
    });
  }
  return plan.synthesis ? applyProjectIndexRecoverySynthesis(fs, plan.synthesis) : plan.index;
}
