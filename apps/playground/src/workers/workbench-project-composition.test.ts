import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import type {
  PackageEditPreflight,
  PackageMutationExecutor,
  PackageMutationIntents,
} from '../glue/package-mutation-executor.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

function realProjectVfs() {
  const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
    ownerEpoch: 'composition-owner',
    initialRoots: ['/'],
  });
  authority.mkdirSync(ROOT, { recursive: true });
  const packageMutations: PackageMutationExecutor = {
    async guardedMutation<T>(
      _intents: PackageMutationIntents,
      mutate: () => Promise<T>,
      preflight?: PackageEditPreflight<T>,
    ): Promise<T> {
      const checked = await preflight?.();
      return checked?.status === 'noop' ? checked.value : mutate();
    },
    async reset(): Promise<void> {
      throw new Error('reset is outside this contract');
    },
    async packageJsonEdit<T>(): Promise<T> {
      throw new Error('packageJsonEdit is outside this contract');
    },
  };
  return createWorkbenchProjectVfs({
    projectRoot: ROOT,
    authority,
    packageMutations,
    durability: 'ephemeral',
    emit: () => {},
  });
}

describe('Workbench project composition', () => {
  it('fences the real Project VFS when runtime construction fails', async () => {
    const vfs = realProjectVfs();
    const constructionFailure = new Error('runtime construction failed');

    await expect(
      createWorkbenchProjectComposition({
        createVfs: () => vfs,
        createRuntime() {
          throw constructionFailure;
        },
      }),
    ).rejects.toBe(constructionFailure);
    expect(() => vfs.publishSnapshot()).toThrow(ClosedHandleError);
  });

  it('preserves construction and VFS cleanup failures together', async () => {
    const realVfs = realProjectVfs();
    const cleanupFailure = new Error('VFS cleanup failed');
    const constructionFailure = new Error('runtime construction failed');
    const failingVfs = Object.freeze({
      handleFrame: realVfs.handleFrame,
      publishSnapshot: realVfs.publishSnapshot,
      async close(): Promise<void> {
        await realVfs.close();
        throw cleanupFailure;
      },
    });

    const failure = await createWorkbenchProjectComposition({
      createVfs: () => failingVfs,
      createRuntime() {
        throw constructionFailure;
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([constructionFailure, cleanupFailure]);
    expect(() => realVfs.publishSnapshot()).toThrow(ClosedHandleError);
  });
});
