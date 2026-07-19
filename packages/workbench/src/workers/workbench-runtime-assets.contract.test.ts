import {
  EMPTY_SHADOW_ASSET_PLAN,
  type InstallResult,
  type ShadowAssetPlan,
  type ShadowAssetReadyReceipt,
  type ShadowAssetSource,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import {
  builtinShadowAssetCatalog,
  builtinSyntheticPackageRecipes,
} from '@riftydev/shadow-registry';
import { describe, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import type { PackageAcquisitionProject } from './package-acquisition-authority.ts';
import { createNpmPackageRuntimeAssetPort } from './workbench-runtime-assets.ts';

const PROJECT: PackageAcquisitionProject = Object.freeze({
  projectId: 'app',
  root: '/projects/app',
  slug: 'app',
  identity: installArtifactIdentity,
});

function assetPlan(): ShadowAssetPlan {
  return planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      builtin: true,
    },
  ]);
}

function receipt(plan: ShadowAssetPlan): ShadowAssetReadyReceipt {
  const catalog = plan.substitutions[0]?.catalog;
  if (catalog === undefined) throw new Error('fixture expected non-empty plan');
  return Object.freeze({
    schema: 1,
    receiptSha256: 'b'.repeat(64),
    requiredSetDigest: plan.requiredSetDigest,
    catalog,
    storageClass: 'memory-session',
    substitutions: plan.substitutions,
    assets: plan.assets.map((asset) =>
      Object.freeze({
        id: asset.id,
        source: asset.source,
        member: asset.member,
        memberSha256: asset.memberSha256,
        memberSize: asset.memberSize,
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }),
    ),
  });
}

function installResult(
  plan: ShadowAssetPlan = EMPTY_SHADOW_ASSET_PLAN,
  ready: ShadowAssetReadyReceipt | undefined = undefined,
): InstallResult {
  return {
    packages: [],
    lockfile: {
      name: 'app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: { resolution: 'metadata', packages: [] },
    ...(ready === undefined
      ? {}
      : { shadowAssets: { kind: 'ready' as const, plan, receipt: ready } }),
  };
}

function lockfileBytes(plan: ShadowAssetPlan): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      name: 'app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/esbuild': {
          version: '0.28.0',
          dependencies: {},
          rifty: {
            materialization: {
              protocol: 'rifty.lockfile-package-materialization/v1',
              kind: 'synthesized-shadow-delegate',
              substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
              recipeSha256: builtinSyntheticPackageRecipes[0]!.recipeSha256,
            },
          },
        },
      },
      rifty: {
        shadowSubstitutions: {
          protocol: 'rifty.lockfile-shadow-substitutions/v1',
          applied: plan.substitutions.map((substitution) => ({
            publicName: substitution.publicName,
            requestedRange: substitution.requestedRange,
            resolvedPublicVersion: substitution.resolvedPublicVersion,
            runtimeAdapterId: substitution.runtimeAdapterId,
            substitutionId: substitution.substitutionId,
          })),
        },
      },
    }),
  );
}

function managerHarness() {
  const acquire = vi.fn<ShadowAssetSource['acquire']>(async () => {
    throw new Error('composition unexpectedly acquired bytes');
  });
  const close = vi.fn(async () => undefined);
  const manager = createShadowAssetManager({
    storage: createMemoryShadowAssetStorage(),
    source: { acquire, close },
  });
  return { manager, acquire, close };
}

describe('Workbench npm runtime-asset production composition', () => {
  it('binds the storage-owned manager installer and preserves a fresh install receipt', async () => {
    const harness = managerHarness();
    const plan = assetPlan();
    const ready = receipt(plan);
    const port = createNpmPackageRuntimeAssetPort(harness.manager);
    try {
      expect(port.installer).toBe(harness.manager.installer);
      await expect(
        port.produce({ kind: 'install', project: PROJECT, result: installResult(plan, ready) }),
      ).resolves.toEqual({ plan, receipt: ready });
      expect(harness.acquire).not.toHaveBeenCalled();
    } finally {
      await harness.manager.close();
    }
  });

  it('derives trusted/snapshot facts only from the exact stored lockfile bytes', async () => {
    const harness = managerHarness();
    const plan = assetPlan();
    const port = createNpmPackageRuntimeAssetPort(harness.manager);
    try {
      await expect(
        port.produce({
          kind: 'lockfile',
          outcome: 'trusted',
          project: PROJECT,
          lockfileBytes: lockfileBytes(plan),
        }),
      ).resolves.toEqual({ plan });
      expect(harness.acquire).not.toHaveBeenCalled();
    } finally {
      await harness.manager.close();
    }
  });

  it('keeps a Vite 8-style empty result canonical and performs zero source work', async () => {
    const harness = managerHarness();
    const port = createNpmPackageRuntimeAssetPort(harness.manager);
    try {
      await expect(
        port.produce({ kind: 'install', project: PROJECT, result: installResult() }),
      ).resolves.toEqual({ plan: EMPTY_SHADOW_ASSET_PLAN });
      expect(harness.acquire).not.toHaveBeenCalled();
    } finally {
      await harness.manager.close();
    }
  });
});
