import {
  type InstallResult,
  type ShadowAssetEnsureOptions,
  type ShadowAssetInstaller,
  type ShadowAssetPlan,
  type ShadowAssetProgress,
  type ShadowAssetReadyReceipt,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import {
  type PackageAcquisitionAdapter,
  type PackageAcquisitionAuthority,
  type PackageAcquisitionAuthorityOptions,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';

const ROOT = '/projects/app';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"7.3.6"}}\n';
const LOCKFILE = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
const PROJECT: PackageAcquisitionProject = Object.freeze({
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
});

type RuntimeAssetFactsInput =
  | Readonly<{
      kind: 'lockfile';
      outcome: 'trusted' | 'snapshot';
      project: PackageAcquisitionProject;
      lockfileBytes: Uint8Array;
    }>
  | Readonly<{
      kind: 'install';
      project: PackageAcquisitionProject;
      result: InstallResult;
    }>;

interface RuntimeAssetFacts {
  readonly plan: ShadowAssetPlan;
  readonly receipt?: ShadowAssetReadyReceipt;
}

interface PackageRuntimeAssetPort {
  readonly installer: ShadowAssetInstaller;
  produce(input: RuntimeAssetFactsInput): Promise<RuntimeAssetFacts>;
}

type RuntimeAssetAwareFactory = (
  options: PackageAcquisitionAuthorityOptions & {
    readonly runtimeAssets: PackageRuntimeAssetPort;
  },
) => PackageAcquisitionAuthority;

const createRuntimeAssetAwareAuthority =
  createPackageAcquisitionAuthority as unknown as RuntimeAssetAwareFactory;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function plan(): ShadowAssetPlan {
  return planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      builtin: true,
    },
  ]);
}

function receipt(assetPlan: ShadowAssetPlan): ShadowAssetReadyReceipt {
  const catalog = assetPlan.substitutions[0]?.catalog;
  if (!catalog) throw new Error('fixture expected a non-empty plan');
  return Object.freeze({
    schema: 1,
    receiptSha256: 'b'.repeat(64),
    requiredSetDigest: assetPlan.requiredSetDigest,
    catalog,
    storageClass: 'memory-session',
    substitutions: assetPlan.substitutions,
    assets: assetPlan.assets.map((asset) =>
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

function installResult(assetPlan?: ShadowAssetPlan): InstallResult {
  const ready = assetPlan === undefined ? undefined : receipt(assetPlan);
  return {
    packages: [{ name: 'vite', version: '7.3.6', dependencies: {}, files: {} }],
    lockfile: {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: [{ name: 'vite', version: '7.3.6', transport: 'registry' }],
    },
    ...(assetPlan === undefined || ready === undefined
      ? {}
      : { shadowAssets: { kind: 'ready' as const, plan: assetPlan, receipt: ready } }),
  };
}

async function projectVfs(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
  await vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
  return vfs;
}

async function writeTree(vfs: MemoryVfs): Promise<void> {
  await vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
  await vfs.writeFile(`${ROOT}/node_modules/vite/package.json`, '{"version":"7.3.6"}\n');
  await vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
}

function adapterWith(
  overrides: Partial<PackageAcquisitionAdapter> = {},
): PackageAcquisitionAdapter {
  return {
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
    install: async () => {
      throw new Error('unexpected install');
    },
    reset: async () => {},
    switchProject: async () => {},
    ...overrides,
  };
}

function runtimePort(
  facts: RuntimeAssetFacts,
  ensure: (
    plan: ShadowAssetPlan,
    options?: ShadowAssetEnsureOptions,
  ) => ReturnType<ShadowAssetInstaller['ensure']> = async (assetPlan) => {
    const ready = facts.receipt ?? receipt(assetPlan);
    return { kind: 'ready', plan: assetPlan, receipt: ready };
  },
) {
  const inputs: RuntimeAssetFactsInput[] = [];
  const ensureCalls: Array<{
    readonly plan: ShadowAssetPlan;
    readonly options?: ShadowAssetEnsureOptions;
  }> = [];
  const port: PackageRuntimeAssetPort = {
    installer: {
      ensure: async (assetPlan, options) => {
        ensureCalls.push({ plan: assetPlan, ...(options === undefined ? {} : { options }) });
        return ensure(assetPlan, options);
      },
      inspectReceipt: async () => null,
    },
    produce: async (input) => {
      inputs.push(input);
      return facts;
    },
  };
  return { port, inputs, ensureCalls };
}

async function trust(vfs: MemoryVfs): Promise<ReturnType<typeof createInstallStampAuthority>> {
  await writeTree(vfs);
  const stamps = createInstallStampAuthority({ vfs });
  const claim = await stamps.demote(PROJECT);
  const promoted = await stamps.promote(
    { ...PROJECT, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
  if (promoted.status !== 'trusted') throw new Error('fixture failed to trust package tree');
  return stamps;
}

describe('post-tree runtime-asset readiness uses the package FIFO', () => {
  it('holds a trusted-existing return and the next mutation behind exact lockfile readiness', async () => {
    const vfs = await projectVfs();
    const stamps = await trust(vfs);
    const assetPlan = plan();
    const readyReceipt = receipt(assetPlan);
    const readiness = deferred<void>();
    const entered = deferred<void>();
    const runtime = runtimePort({ plan: assetPlan }, async (received, options) => {
      options?.onProgress?.({
        phase: 'cache-check',
        assetId: received.assets[0]!.id,
        assetIndex: 0,
        assetCount: 1,
      });
      entered.resolve();
      await readiness.promise;
      options?.onProgress?.({
        phase: 'verify',
        assetId: received.assets[0]!.id,
        assetIndex: 0,
        assetCount: 1,
      });
      options?.onProgress?.({
        phase: 'ready',
        requiredSetDigest: received.requiredSetDigest,
        assetCount: 1,
        storageClass: 'memory-session',
      });
      return { kind: 'ready', plan: received, receipt: readyReceipt };
    });
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      adapter: adapterWith(),
    });
    const progress: ShadowAssetProgress[] = [];
    const signal = new AbortController().signal;
    const opening = authority.dispatch({
      type: 'ensure',
      project: PROJECT,
      packageJsonText: PACKAGE_JSON,
      runtimeAssets: { signal, onProgress: (event: ShadowAssetProgress) => progress.push(event) },
    } as Parameters<PackageAcquisitionAuthority['dispatch']>[0]);
    let mutationApplied = false;
    const mutation = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: async () => {
        mutationApplied = true;
      },
    });

    const firstSettlement = await Promise.race([
      entered.promise.then(() => 'readiness-entered' as const),
      mutation.then(() => 'mutation-bypassed-readiness' as const),
    ]);
    expect(firstSettlement).toBe('readiness-entered');
    expect(mutationApplied).toBe(false);
    readiness.resolve();
    await expect(opening).resolves.toMatchObject({ outcome: 'existing' });
    await mutation;

    expect(runtime.inputs).toHaveLength(1);
    expect(runtime.inputs[0]).toMatchObject({
      kind: 'lockfile',
      outcome: 'trusted',
      project: PROJECT,
    });
    if (runtime.inputs[0]?.kind !== 'lockfile') throw new Error('expected lockfile facts');
    expect(new TextDecoder().decode(runtime.inputs[0].lockfileBytes)).toBe(LOCKFILE);
    expect(runtime.ensureCalls).toEqual([
      { plan: assetPlan, options: { signal, onProgress: expect.any(Function) } },
    ]);
    expect(progress.map((event) => event.phase)).toEqual(['cache-check', 'verify', 'ready']);
  });

  it('passes a verified snapshot through the same producer and readiness seam before return', async () => {
    const vfs = await projectVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const assetPlan = plan();
    const runtime = runtimePort({ plan: assetPlan });
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      adapter: adapterWith({
        planSnapshotRestore: async () => ({
          status: 'ready',
          packages: 1,
          apply: async () => writeTree(vfs),
        }),
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        snapshot: {
          snapshotId: 'snapshot-v2',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).resolves.toMatchObject({ outcome: 'snapshot' });

    expect(runtime.inputs).toHaveLength(1);
    expect(runtime.inputs[0]).toMatchObject({ kind: 'lockfile', outcome: 'snapshot' });
    expect(runtime.ensureCalls).toHaveLength(1);
  });

  it('uses the exact fresh-install result and never repeats an already-ready receipt', async () => {
    const vfs = await projectVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const assetPlan = plan();
    const readyReceipt = receipt(assetPlan);
    const installed = installResult(assetPlan);
    const runtime = runtimePort({ plan: assetPlan, receipt: readyReceipt });
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      adapter: adapterWith({
        install: async () => {
          await writeTree(vfs);
          return { result: installed, packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'ensure', project: PROJECT, packageJsonText: PACKAGE_JSON }),
    ).resolves.toMatchObject({ outcome: 'installed' });

    expect(runtime.inputs).toEqual([{ kind: 'install', project: PROJECT, result: installed }]);
    expect(runtime.ensureCalls).toEqual([]);
  });

  it('keeps deferred first materialization non-installing, then readies on its terminal install', async () => {
    const vfs = await projectVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const assetPlan = plan();
    const installed = installResult(assetPlan);
    const runtime = runtimePort({ plan: assetPlan, receipt: receipt(assetPlan) });
    let installs = 0;
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      captureDeferredTerminalConsumption: () => ({
        reuseTrustedClaim: true,
        settle: () => {},
      }),
      adapter: adapterWith({
        install: async () => {
          installs += 1;
          await writeTree(vfs);
          return { result: installed, packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => {},
        from: null,
        to: PROJECT,
        packageJsonText: PACKAGE_JSON,
        materialization: { kind: 'install' },
      }),
    ).resolves.toEqual({ kind: 'install', snapshotFailures: [] });
    expect(installs).toBe(0);
    expect(runtime.inputs).toEqual([]);

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toMatchObject({ outcome: 'installed' });
    expect(installs).toBe(1);
    expect(runtime.inputs).toEqual([{ kind: 'install', project: PROJECT, result: installed }]);
    expect(runtime.ensureCalls).toEqual([]);
  });

  it('routes every later terminal install through readiness before reporting success', async () => {
    const vfs = await projectVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const assetPlan = plan();
    const runtime = runtimePort({ plan: assetPlan });
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      adapter: adapterWith({
        install: async () => {
          await writeTree(vfs);
          return { result: installResult(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toMatchObject({ outcome: 'installed' });
    expect(runtime.inputs[0]).toMatchObject({ kind: 'install', project: PROJECT });
    expect(runtime.ensureCalls).toHaveLength(1);
  });

  it('isolates a throwing progress observer while preserving all later phases', async () => {
    const vfs = await projectVfs();
    const stamps = await trust(vfs);
    const assetPlan = plan();
    const runtime = runtimePort({ plan: assetPlan }, async (received, options) => {
      for (const event of [
        {
          phase: 'cache-check' as const,
          assetId: received.assets[0]!.id,
          assetIndex: 0,
          assetCount: 1,
        },
        {
          phase: 'verify' as const,
          assetId: received.assets[0]!.id,
          assetIndex: 0,
          assetCount: 1,
        },
        {
          phase: 'ready' as const,
          requiredSetDigest: received.requiredSetDigest,
          assetCount: 1,
          storageClass: 'memory-session' as const,
        },
      ]) {
        options?.onProgress?.(event);
      }
      return { kind: 'ready', plan: received, receipt: receipt(received) };
    });
    const authority = createRuntimeAssetAwareAuthority({
      stamps,
      runtimeAssets: runtime.port,
      adapter: adapterWith(),
    });
    const phases: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        authority.dispatch({
          type: 'ensure',
          project: PROJECT,
          packageJsonText: PACKAGE_JSON,
          runtimeAssets: {
            onProgress: (event: ShadowAssetProgress) => {
              phases.push(event.phase);
              if (event.phase === 'cache-check') throw new Error('observer failed');
            },
          },
        } as Parameters<PackageAcquisitionAuthority['dispatch']>[0]),
      ).resolves.toMatchObject({ outcome: 'existing' });
    } finally {
      warn.mockRestore();
    }
    expect(phases).toEqual(['cache-check', 'verify', 'ready']);
  });
});
