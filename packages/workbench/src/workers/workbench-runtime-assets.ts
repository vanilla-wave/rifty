import {
  EMPTY_SHADOW_ASSET_PLAN,
  type ShadowAssetManager,
  shadowAssetPlanFromLockfileBytes,
} from '@riftydev/npm-client';
import type {
  PackageRuntimeAssetFacts,
  PackageRuntimeAssetFactsInput,
  PackageRuntimeAssetPort,
} from './package-acquisition-authority.ts';

/** Concrete npm-client v0 producer bound to the storage-owned owner manager. */
export function createNpmPackageRuntimeAssetPort(
  manager: ShadowAssetManager,
): PackageRuntimeAssetPort {
  return Object.freeze({
    installer: manager.installer,
    produce: async (input: PackageRuntimeAssetFactsInput): Promise<PackageRuntimeAssetFacts> => {
      if (input.kind === 'lockfile') {
        return Object.freeze({ plan: shadowAssetPlanFromLockfileBytes(input.lockfileBytes) });
      }
      const ready = input.result.shadowAssets;
      return ready === undefined
        ? Object.freeze({ plan: EMPTY_SHADOW_ASSET_PLAN })
        : Object.freeze({ plan: ready.plan, receipt: ready.receipt });
    },
  });
}
