import {
  type InstallOptions,
  type InstallResult,
  RegistryClient,
  ShadowAssetInstallError,
  type ShadowAssetPlan,
  type ShadowAssetReadyReceipt,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import type { CommandContext } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { readInstallStamp, stampTrusted } from '../glue/install-stamp.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import {
  type FirstMaterializationOwnerPackageConfig,
  createOwnerPackageState,
} from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PackageAcquisitionAdapter,
  PackageAcquisitionError,
  type PackageAcquisitionProject,
  type PackageRuntimeAssetFactsInput,
  type PackageRuntimeAssetPort,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { postTreePackageFinalizationFailure } from './package-install-finalizer.ts';

const ROOT = '/project';
const PROJECT = Object.freeze({ root: ROOT, slug: 'scratch' });
const PACKAGE_JSON = '{"name":"app","version":"1.0.0","dependencies":{"kleur":"4.1.5"}}\n';
const LOCKFILE = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
const TEMPLATE_SEED = `${ROOT}/node_modules/@rifty/template/runtime.bin`;
const TEMPLATE_BYTES = Uint8Array.from([0, 255, 1, 128, 13, 10]);

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
  if (!catalog) throw new Error('fixture expected one substitution');
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

function installResult(): InstallResult {
  return {
    packages: [{ name: 'kleur', version: '4.1.5', dependencies: {}, files: {} }],
    lockfile: {
      name: 'app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        'node_modules/@esbuild/wasi-preview1': {
          version: '0.28.0',
          dependencies: {},
        },
      },
      rifty: {
        shadowSubstitutions: {
          protocol: 'rifty.lockfile-shadow-substitutions/v1',
          applied: [
            {
              publicName: 'esbuild',
              requestedRange: '^0.28.0',
              resolvedPublicVersion: '0.28.0',
              runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
              substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
            },
          ],
        },
      },
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: [{ name: 'kleur', version: '4.1.5', transport: 'registry' }],
    },
  };
}

function shadowFailure(installed: InstallResult, assetPlan: ShadowAssetPlan) {
  return new ShadowAssetInstallError(installed, assetPlan, {
    message: 'verified object could not be persisted',
    requiredSetDigest: assetPlan.requiredSetDigest,
    assetId: assetPlan.assets[0]!.id,
    phase: 'persist',
    transports: [{ transport: 'standard', message: 'quota exhausted' }],
    recovery: 'clear-and-retry',
  });
}

function bootstrapConfig(): BootstrapConfig {
  return {
    runtime: 'vite',
    root: ROOT,
    port: 5173,
    entryPath: `${ROOT}/src/main.ts`,
    packageName: 'app',
    packageVersion: '1.0.0',
    installDeps: { kleur: '4.1.5' },
    packageJson: PACKAGE_JSON,
    seedFiles: {},
  };
}

function firstMaterializationConfig(
  templateNodeModulesFiles: Readonly<Record<string, string | Uint8Array>> = {},
): FirstMaterializationOwnerPackageConfig {
  return {
    cfg: bootstrapConfig(),
    templateId: 'runtime-asset-fault',
    slug: PROJECT.slug,
    fromScratch: true,
    firstMaterialization: { kind: 'install' },
    templateNodeModulesFiles,
  };
}

function commandContext(onStderr?: () => void): CommandContext {
  return {
    cwd: ROOT,
    env: {},
    stdout: { write: (_chunk: string | Uint8Array): void => {} },
    stderr: {
      write(_chunk: string | Uint8Array): void {
        onStderr?.();
      },
    },
  };
}

function adapterWith(overrides: Partial<PackageAcquisitionAdapter>): PackageAcquisitionAdapter {
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

afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('owner post-tree runtime-asset commit order', () => {
  // Fault classes: torn-state + observable-order. The owner finalizer is the
  // last tree writer, so its exact seed must precede stamp/readiness publication.
  it('restores exact binary template-owned files before promotion, pending publication, and report', async () => {
    const pair = createMemoryFs();
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
      ownerEpoch: 'runtime-asset-seed-before-promotion',
      initialRoots: ['/'],
    });
    setSyncMirror(authority, { async: pair.vfs });
    authority.mkdirSync(ROOT, { recursive: true });
    authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    const assetPlan = plan();
    const assetError = shadowFailure(installResult(), assetPlan);
    const seedAtFlush: Array<readonly number[] | null> = [];
    const config = firstMaterializationConfig({ [TEMPLATE_SEED]: TEMPLATE_BYTES });
    const state = createOwnerPackageState({
      vfs: pair.vfs,
      fsSync: authority,
      installStampClaims,
      flush: async () => {
        seedAtFlush.push(
          authority.existsSync(TEMPLATE_SEED)
            ? [...authority.readFileBytesSync(TEMPLATE_SEED)]
            : null,
        );
        return { failures: [], total: 0 };
      },
      nodeWorkerRuntimeEnv: {},
      log: () => {},
      registry: new RegistryClient({
        baseUrl: '/unused',
        fetch: async () => new Response(null, { status: 599 }),
      }),
      install: async (arg1) => {
        const options = arg1 as InstallOptions;
        authority.mkdirSync(`${ROOT}/node_modules/kleur`, { recursive: true });
        authority.writeFileSync(
          `${ROOT}/node_modules/kleur/index.js`,
          new TextEncoder().encode('module.exports = true;\n'),
        );
        await options.vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
        throw assetError;
      },
      resolverUrl: () => undefined,
      resolverBundleBaseUrl: () => undefined,
      resolverPin: () => undefined,
    });

    await expect(state.activateAndEnsure(config)).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [],
    });
    const reportSnapshots: Array<{
      readonly seed: readonly number[] | null;
      readonly readiness: string;
    }> = [];
    const npm = state.createNpmCommand(async () => 0);
    await expect(
      npm(
        ['install'],
        commandContext(() => {
          if (reportSnapshots.length > 0) return;
          reportSnapshots.push({
            seed: authority.existsSync(TEMPLATE_SEED)
              ? [...authority.readFileBytesSync(TEMPLATE_SEED)]
              : null,
            readiness: state.readPackageTreeEpoch(PROJECT).readiness.kind,
          });
        }),
      ),
    ).resolves.toBe(1);
    await state.quiesce();

    expect.soft(seedAtFlush).toEqual([[...TEMPLATE_BYTES]]);
    expect.soft(reportSnapshots).toEqual([{ seed: [...TEMPLATE_BYTES], readiness: 'pending' }]);
    const finalSeed = authority.existsSync(TEMPLATE_SEED)
      ? [...authority.readFileBytesSync(TEMPLATE_SEED)]
      : null;
    expect.soft(finalSeed).toEqual([...TEMPLATE_BYTES]);
    expect.soft(state.readPackageTreeEpoch(PROJECT).readiness).toEqual({
      kind: 'pending',
      plan: assetPlan,
    });
    const stamp = await readInstallStamp(pair.vfs, ROOT);
    expect(stamp).not.toBeNull();
    if (stamp) expect(stampTrusted(stamp)).toBe(true);
  });

  it('does not publish or promote when the owner-aware seed finalizer fails', async () => {
    const pair = createMemoryFs();
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
      ownerEpoch: 'runtime-asset-owner-finalizer-failure',
      initialRoots: ['/'],
    });
    setSyncMirror(authority, { async: pair.vfs });
    authority.mkdirSync(ROOT, { recursive: true });
    authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    const assetPlan = plan();
    const assetError = shadowFailure(installResult(), assetPlan);
    const blockedSeed = `${ROOT}/node_modules/@rifty/template/runtime.bin`;
    const config = firstMaterializationConfig({ [blockedSeed]: TEMPLATE_BYTES });
    const state = createOwnerPackageState({
      vfs: pair.vfs,
      fsSync: authority,
      installStampClaims,
      flush: async () => ({ failures: [], total: 0 }),
      nodeWorkerRuntimeEnv: {},
      log: () => {},
      registry: new RegistryClient({
        baseUrl: '/unused',
        fetch: async () => new Response(null, { status: 599 }),
      }),
      install: async (arg1) => {
        const options = arg1 as InstallOptions;
        authority.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
        authority.writeFileSync(
          `${ROOT}/node_modules/@rifty`,
          new TextEncoder().encode('blocks the template directory\n'),
        );
        await options.vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
        throw assetError;
      },
      resolverUrl: () => undefined,
      resolverBundleBaseUrl: () => undefined,
      resolverPin: () => undefined,
    });

    await expect(state.activateAndEnsure(config)).resolves.toMatchObject({ kind: 'install' });
    const npm = state.createNpmCommand(async () => 0);
    await expect(npm(['install'], commandContext())).resolves.toBe(1);
    await state.quiesce();

    expect(await readInstallStamp(pair.vfs, ROOT)).toBeNull();
    expect(state.readPackageTreeEpoch(PROJECT).readiness).toEqual({ kind: 'unavailable' });
  });

  // The special post-tree pair is already the complete causal error. A broad
  // AggregateError escape would lie for ordinary pre-tree acquisition failures.
  it('preserves the exact post-tree aggregate while still wrapping an ordinary pre-tree aggregate', async () => {
    const assetPlan = plan();
    const assetError = shadowFailure(installResult(), assetPlan);
    const finalizerError = new Error('template seed parent is not a directory');
    const postTreeFailure = postTreePackageFinalizationFailure(assetError, finalizerError);
    const project: PackageAcquisitionProject = {
      projectId: 'scratch',
      root: ROOT,
      slug: 'scratch',
      identity: installArtifactIdentity,
    };
    const postTreeVfs = new MemoryVfs();
    await postTreeVfs.mkdir(ROOT, { recursive: true });
    await postTreeVfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    const promotion = vi.fn();
    const postTreeAuthority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs: postTreeVfs }),
      adapter: adapterWith({
        install: async () => {
          await postTreeVfs.mkdir(`${ROOT}/node_modules/kleur`, { recursive: true });
          await postTreeVfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
          throw postTreeFailure;
        },
      }),
    });

    let caught: unknown;
    try {
      await postTreeAuthority.dispatch({
        type: 'terminal-install',
        project,
        argv: [],
        onPromotion: promotion,
      });
    } catch (error) {
      caught = error;
    }
    expect.soft(caught).toBe(postTreeFailure);
    expect.soft([...(postTreeFailure.errors as unknown[])]).toEqual([assetError, finalizerError]);
    expect.soft(promotion).not.toHaveBeenCalled();
    expect.soft(await readInstallStamp(postTreeVfs, ROOT)).toBeNull();

    const preTreeFailure = new AggregateError(
      [assetError, finalizerError],
      postTreeFailure.message,
    );
    const preTreeVfs = new MemoryVfs();
    await preTreeVfs.mkdir(ROOT, { recursive: true });
    await preTreeVfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    const preTreeAuthority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs: preTreeVfs }),
      adapter: adapterWith({ install: async () => Promise.reject(preTreeFailure) }),
    });

    let wrapped: unknown;
    try {
      await preTreeAuthority.dispatch({ type: 'terminal-install', project, argv: [] });
    } catch (error) {
      wrapped = error;
    }
    expect(wrapped).toBeInstanceOf(PackageAcquisitionError);
    expect((wrapped as PackageAcquisitionError).failure).toBe('install');
    expect((wrapped as PackageAcquisitionError).cause).toBe(preTreeFailure);
  });
});

describe('deferred first materialization runtime readiness', () => {
  // Fault class: concurrent-same-key. Consumption belongs to the whole FIFO
  // authority operation, not the adapter-return substep.
  it('retries readiness over the promoted tree, then consumes the deferred state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pair = createMemoryFs();
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
      ownerEpoch: 'first-materialization-runtime-readiness-retry',
      initialRoots: ['/'],
    });
    setSyncMirror(authority, { async: pair.vfs });
    authority.mkdirSync(ROOT, { recursive: true });
    authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    const assetPlan = plan();
    const readyReceipt = receipt(assetPlan);
    const readinessEntered = deferred<void>();
    const releaseFirstReadiness = deferred<void>();
    const readinessFailure = new Error('runtime storage temporarily unavailable');
    const facts: PackageRuntimeAssetFactsInput[] = [];
    let readinessCalls = 0;
    const runtimeAssets: PackageRuntimeAssetPort = {
      installer: {
        ensure: async (received) => {
          readinessCalls += 1;
          if (readinessCalls === 1) {
            readinessEntered.resolve();
            await releaseFirstReadiness.promise;
            throw readinessFailure;
          }
          return { kind: 'ready', plan: received, receipt: readyReceipt };
        },
        inspectReceipt: async () => null,
      },
      produce: async (input) => {
        facts.push(input);
        return { plan: assetPlan };
      },
    };
    let physicalInstalls = 0;
    const state = createOwnerPackageState({
      vfs: pair.vfs,
      fsSync: authority,
      installStampClaims,
      flush: async () => ({ failures: [], total: 0 }),
      nodeWorkerRuntimeEnv: {},
      log: () => {},
      registry: new RegistryClient({
        baseUrl: '/unused',
        fetch: async () => new Response(null, { status: 599 }),
      }),
      runtimeAssets,
      install: async (arg1) => {
        const options = arg1 as InstallOptions;
        physicalInstalls += 1;
        authority.mkdirSync(`${ROOT}/node_modules/kleur`, { recursive: true });
        authority.writeFileSync(
          `${ROOT}/node_modules/kleur/index.js`,
          new TextEncoder().encode(`install ${physicalInstalls}\n`),
        );
        await options.vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
        return installResult();
      },
      resolverUrl: () => undefined,
      resolverBundleBaseUrl: () => undefined,
      resolverPin: () => undefined,
    });
    const config = firstMaterializationConfig();
    await expect(state.activateAndEnsure(config)).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [],
    });
    const npm = state.createNpmCommand(async () => 0);

    const first = npm(['install'], commandContext());
    await readinessEntered.promise;
    expect(physicalInstalls).toBe(1);
    const second = npm(['install'], commandContext());
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    releaseFirstReadiness.resolve();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(0);
    expect.soft(physicalInstalls).toBe(1);
    expect.soft(facts.map((input) => input.kind)).toEqual(['install', 'lockfile']);
    expect.soft(facts[1]).toMatchObject({ kind: 'lockfile', outcome: 'trusted' });
    const retryLockfile = facts[1]?.kind === 'lockfile' ? facts[1].lockfileBytes : null;
    expect
      .soft(retryLockfile === null ? null : new TextDecoder().decode(retryLockfile))
      .toBe(LOCKFILE);
    expect
      .soft(
        new TextDecoder().decode(
          authority.readFileBytesSync(`${ROOT}/node_modules/kleur/index.js`),
        ),
      )
      .toBe('install 1\n');
    expect.soft(readinessCalls).toBe(2);
    expect.soft(state.readPackageTreeEpoch(PROJECT).readiness).toEqual({
      kind: 'ready',
      plan: assetPlan,
      receipt: readyReceipt,
    });

    await expect(npm(['install'], commandContext())).resolves.toBe(0);
    expect(physicalInstalls).toBe(2);
    expect(facts.map((input) => input.kind)).toEqual(['install', 'lockfile', 'install']);
  });
});
