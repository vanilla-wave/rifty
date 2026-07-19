import type { PersistFailureReport } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type WorkbenchOwnerStorageCompositionDependencies,
  createWorkbenchOwnerStorageComposition,
} from './workbench-owner-storage-composition.ts';

type StorageBackend = 'memory' | 'opfs';
type FailureBoundary = 'install' | 'retention' | 'owner' | 'mirror' | 'adapter';

interface StorageFaultHarness {
  readonly dependencies: WorkbenchOwnerStorageCompositionDependencies;
  readonly events: string[];
  readonly constructionFailure: Error;
  readonly cleanupFailure: Error;
  readonly flush: ReturnType<typeof vi.fn<() => Promise<PersistFailureReport>>>;
}

function storageFaultHarness(
  backend: StorageBackend,
  failureAt: FailureBoundary,
  cleanupFails = false,
): StorageFaultHarness {
  const events: string[] = [];
  const constructionFailure = new Error(`${failureAt} construction failed`);
  const cleanupFailure = new Error('owner authority cleanup failed');
  const flush = vi.fn(async (): Promise<PersistFailureReport> => {
    events.push('authority:flush');
    if (cleanupFails) throw cleanupFailure;
    return { failures: [], total: 0 };
  });
  let ownerSequence = 0;

  const dependencies: WorkbenchOwnerStorageCompositionDependencies = {
    async installStorage() {
      events.push('storage:install');
      if (failureAt === 'install') throw constructionFailure;
      return backend === 'memory'
        ? { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' }
        : { policy: 'required', backend: 'opfs', durability: 'durable' };
    },
    async probeRetention() {
      events.push('storage:retention');
      if (failureAt === 'retention') throw constructionFailure;
      return { available: true, persistedAfter: false };
    },
    createOwner(): OwnerVfsAuthorityComposition {
      events.push('owner:create');
      if (failureAt === 'owner') throw constructionFailure;
      ownerSequence += 1;
      const fs = Object.assign(new MemoryFsSync(), { flush });
      return createOwnerVfsAuthorityComposition(fs, {
        ownerEpoch: `storage-fault-owner-${String(ownerSequence)}`,
        initialRoots: ['/'],
      });
    },
    attachAsyncMirror() {
      events.push('mirror:attach');
      if (failureAt === 'mirror') throw constructionFailure;
    },
    createRuntimeAssets() {
      events.push('runtime-assets:create');
      if (failureAt === 'adapter') throw constructionFailure;
      throw new Error('test did not select a failing construction boundary');
    },
  };

  return { dependencies, events, constructionFailure, cleanupFailure, flush };
}

function expectedEvents(backend: StorageBackend, failureAt: FailureBoundary): readonly string[] {
  const events = ['storage:install'];
  if (failureAt === 'install') return events;
  if (backend === 'opfs') {
    events.push('storage:retention');
    if (failureAt === 'retention') return events;
  }
  events.push('owner:create');
  if (failureAt === 'owner') return events;
  events.push('mirror:attach');
  if (failureAt === 'mirror') return [...events, 'authority:flush'];
  events.push('runtime-assets:create', 'authority:flush');
  return events;
}

describe('torn-state: Workbench owner storage composition construction rollback', () => {
  it.each([
    ['memory', 'install'],
    ['memory', 'owner'],
    ['memory', 'mirror'],
    ['memory', 'adapter'],
    ['opfs', 'install'],
    ['opfs', 'retention'],
    ['opfs', 'owner'],
    ['opfs', 'mirror'],
    ['opfs', 'adapter'],
  ] as const)(
    'closes the constructed %s ownership prefix exactly once when %s construction fails',
    async (backend, failureAt) => {
      const harness = storageFaultHarness(backend, failureAt);

      const failure = await createWorkbenchOwnerStorageComposition(
        backend === 'memory' ? 'ephemeral' : 'required',
        harness.dependencies,
      ).catch((error: unknown) => error);

      expect(failure).toBe(harness.constructionFailure);
      expect(harness.events).toEqual(expectedEvents(backend, failureAt));
      expect(harness.flush).toHaveBeenCalledTimes(
        failureAt === 'mirror' || failureAt === 'adapter' ? 1 : 0,
      );
    },
  );

  it.each([
    ['memory', 'mirror'],
    ['memory', 'adapter'],
    ['opfs', 'mirror'],
    ['opfs', 'adapter'],
  ] as const)(
    'keeps the %s %s failure first when authority cleanup also fails',
    async (backend, failureAt) => {
      const harness = storageFaultHarness(backend, failureAt, true);

      const failure = await createWorkbenchOwnerStorageComposition(
        backend === 'memory' ? 'ephemeral' : 'required',
        harness.dependencies,
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        harness.constructionFailure,
        harness.cleanupFailure,
      ]);
      expect(harness.events).toEqual(expectedEvents(backend, failureAt));
      expect(harness.flush).toHaveBeenCalledTimes(1);
    },
  );
});
