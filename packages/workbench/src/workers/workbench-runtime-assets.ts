import {
  type ShadowAssetManager,
  packageTreeRuntimeFactsFromLockfileBytes,
} from '@riftydev/npm-client';
import type {
  PackageRuntimeAssetFacts,
  PackageRuntimeAssetFactsInput,
  PackageRuntimeAssetPort,
} from './package-acquisition-authority.ts';

const encoder = new TextEncoder();

/** Concrete npm-client v0 producer bound to the storage-owned owner manager. */
export function createNpmPackageRuntimeAssetPort(
  manager: ShadowAssetManager,
): PackageRuntimeAssetPort {
  return Object.freeze({
    installer: manager.installer,
    produce: async (input: PackageRuntimeAssetFactsInput): Promise<PackageRuntimeAssetFacts> => {
      if (input.kind === 'lockfile') {
        return packageTreeRuntimeFactsFromLockfileBytes(input.lockfileBytes);
      }
      const ready = input.result.shadowAssets;
      const facts = packageTreeRuntimeFactsFromLockfileBytes(
        encoder.encode(JSON.stringify(input.result.lockfile)),
      );
      if (ready !== undefined && ready.plan.requiredSetDigest !== facts.plan.requiredSetDigest) {
        throw new Error('install runtime-asset receipt does not match its exact lockfile facts');
      }
      return ready === undefined
        ? facts
        : Object.freeze({
            plan: facts.plan,
            receipt: ready.receipt,
            rootPackageVersionsByInstallPath: facts.rootPackageVersionsByInstallPath,
          });
    },
  });
}
