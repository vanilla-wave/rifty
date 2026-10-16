import type { VfsMutationGuard, VfsMutationIntent } from '@riftydev/vfs';
import { guestPrivateRoot } from './guest-layout.ts';
import type { WorkbenchProjectVfs } from './workbench-project-vfs.ts';

const within = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * The project-publication intent for one child intent, or `null` when it writes
 * only the active project's private guest area (ADR-0531 §5: persisted by the
 * owner authority, never published as project files).
 */
function projectIntent(privateRoot: string, intent: VfsMutationIntent): VfsMutationIntent | null {
  if ('path' in intent) return within(privateRoot, intent.path) ? null : intent;
  if (within(privateRoot, intent.targetPath)) return null;
  return intent.kind === 'copy' && within(privateRoot, intent.sourcePath)
    ? { kind: 'write', path: intent.targetPath }
    : intent;
}

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
    const projectIntents = intents
      .map((intent) => projectIntent(guestPrivateRoot(admitted.root), intent))
      .filter((intent): intent is VfsMutationIntent => intent !== null);
    return (async () => {
      let result: Awaited<ReturnType<typeof apply>>;
      try {
        result =
          projectIntents.length === 0
            ? await apply()
            : await admitted.vfs.mutationGuard(projectIntents, apply);
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
