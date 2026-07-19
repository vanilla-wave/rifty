import { runtimeAssetError } from '../workbench/errors.ts';
import type { ProjectMaterializer } from '../workbench/project-materialization.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import type { PlaygroundProjectAuthority } from './playground-project-authority.ts';
import { workbenchFinalDurabilityError } from './workbench-owner-storage.ts';

export function assertCleanDurability(
  report: Awaited<ReturnType<OwnerVfsAuthority['flush']>>,
): void {
  const failure = workbenchFinalDurabilityError(report);
  if (failure !== null) throw failure;
}

export function withOwnerClose(
  materializer: ProjectMaterializer,
  packageQuiesce: () => Promise<void>,
  runtimeAssetsClose: () => Promise<void>,
  authority: OwnerVfsAuthority,
  ownerPrivateClose?: () => void,
): ProjectMaterializer {
  let closePromise: Promise<void> | null = null;
  return Object.freeze({
    open: (...args: Parameters<ProjectMaterializer['open']>) => materializer.open(...args),
    delete: (...args: Parameters<ProjectMaterializer['delete']>) => materializer.delete(...args),
    cancelActiveAcquisition: (reason?: unknown) => materializer.cancelActiveAcquisition(reason),
    close() {
      if (closePromise !== null) return closePromise;
      closePromise = (async () => {
        const failures: unknown[] = [];
        try {
          await materializer.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await packageQuiesce();
        } catch (error) {
          failures.push(error);
        }
        try {
          await runtimeAssetsClose();
        } catch (error) {
          failures.push(runtimeAssetError('close', error));
        }
        try {
          ownerPrivateClose?.();
        } catch (error) {
          failures.push(error);
        }
        try {
          assertCleanDurability(await authority.flush());
        } catch (error) {
          failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Workbench owner authority close failed');
        }
      })();
      return closePromise;
    },
  });
}

export function createCompanionOwnerClose(
  authority: PlaygroundProjectAuthority,
  unsubscribeCatalog: () => void,
  packageQuiesce: () => Promise<void>,
  runtimeAssetsClose: () => Promise<void>,
  vfsAuthority: OwnerVfsAuthority,
  ownerPrivateClose?: () => void,
): () => Promise<void> {
  let closePromise: Promise<void> | null = null;
  return () => {
    if (closePromise !== null) return closePromise;
    closePromise = (async () => {
      const failures: unknown[] = [];
      try {
        unsubscribeCatalog();
      } catch (error) {
        failures.push(error);
      }
      try {
        await authority.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await packageQuiesce();
      } catch (error) {
        failures.push(error);
      }
      try {
        await runtimeAssetsClose();
      } catch (error) {
        failures.push(runtimeAssetError('close', error));
      }
      try {
        ownerPrivateClose?.();
      } catch (error) {
        failures.push(error);
      }
      try {
        assertCleanDurability(await vfsAuthority.flush());
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Playground owner authority close failed');
      }
    })();
    return closePromise;
  };
}
