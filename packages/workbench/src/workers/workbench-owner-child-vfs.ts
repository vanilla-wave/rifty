import type { VfsMutationGuard } from '@riftydev/vfs';
import type { WorkbenchProjectVfs } from './workbench-project-vfs.ts';

interface ActiveChildVfsProject {
  readonly root: string;
  readonly vfs: Pick<WorkbenchProjectVfs, 'mutationGuard'>;
}

/** One child-write gate: package transition, apply, project publication, reply. */
export function createWorkbenchOwnerChildVfsMutationGuard(options: {
  readonly activeProject: () => ActiveChildVfsProject | null;
}): VfsMutationGuard {
  return (intents, apply) => {
    const admitted = options.activeProject();
    if (admitted === null) {
      throw new Error('ClosedHandleError: no active Workbench project owns child VFS writes');
    }
    return (async () => {
      let result: Awaited<ReturnType<typeof apply>>;
      try {
        result = await admitted.vfs.mutationGuard(intents, apply);
      } catch (error) {
        const current = options.activeProject();
        if (current?.root !== admitted.root || current.vfs !== admitted.vfs) {
          throw new AggregateError(
            [
              error,
              new Error('ClosedHandleError: Workbench project changed during child VFS write'),
            ],
            'Workbench child VFS mutation and project identity check failed',
          );
        }
        throw error;
      }
      const current = options.activeProject();
      if (current?.root !== admitted.root || current.vfs !== admitted.vfs) {
        throw new Error('ClosedHandleError: Workbench project changed during child VFS write');
      }
      return result;
    })();
  };
}
