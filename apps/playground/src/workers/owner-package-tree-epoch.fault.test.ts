import {
  RegistryClient,
  type ShadowAssetInstaller,
  type ShadowAssetPlan,
  type ShadowAssetReadyReceipt,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import type { VfsMutationIntent } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import {
  type OwnerPackageConfig,
  type OwnerPackageState,
  type OwnerPackageStateOptions,
  createOwnerPackageState,
} from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import type { PackageAcquisitionProject } from './package-acquisition-authority.ts';

const ROOT = '/project';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"7.3.6"}}\n';
const PACKAGE_LOCK = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
const enc = new TextEncoder();
const PROJECT = Object.freeze({ root: ROOT, slug: 'app' });
const ACQUISITION_PROJECT: PackageAcquisitionProject = Object.freeze({
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
});

type OwnerPackageTreeReadiness =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'not-required' }>
  | Readonly<{ kind: 'pending'; plan: ShadowAssetPlan }>
  | Readonly<{
      kind: 'ready';
      plan: ShadowAssetPlan;
      receipt: ShadowAssetReadyReceipt;
    }>;

interface OwnerPackageTreeEpoch {
  readonly project: Readonly<{ root: string; slug: string }>;
  readonly sequence: number;
  readonly readiness: OwnerPackageTreeReadiness;
}

interface OwnerChildAdmissionReservation {
  readonly readiness: Extract<OwnerPackageTreeReadiness, { kind: 'not-required' | 'ready' }>;
  commit(): void;
  abortBeforeSpawn(error: unknown): void;
  abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
}

interface AttestedOwnerPackageState extends OwnerPackageState {
  readPackageTreeEpoch(project: Readonly<{ root: string; slug: string }>): OwnerPackageTreeEpoch;
  beginTreeMutation(
    project: Readonly<{ root: string; slug: string }>,
    acquisitionToken: object,
  ): void;
  reserveChildAdmission(
    project: Readonly<{ root: string; slug: string }>,
  ): Promise<OwnerChildAdmissionReservation>;
}

interface RuntimeAssetFactsPort {
  readonly installer: ShadowAssetInstaller;
  produce(input: unknown): Promise<Readonly<{ plan: ShadowAssetPlan }>>;
}

type AttestedOwnerPackageStateFactory = (
  options: OwnerPackageStateOptions & {
    readonly runtimeAssets: RuntimeAssetFactsPort;
  },
) => AttestedOwnerPackageState;

const createAttestedOwnerPackageState =
  createOwnerPackageState as unknown as AttestedOwnerPackageStateFactory;

interface Harness {
  readonly state: AttestedOwnerPackageState;
  readonly owner: ReturnType<typeof createOwnerVfsAuthorityComposition>['authority'];
  readonly config: OwnerPackageConfig;
  readonly plan: ShadowAssetPlan;
  readonly receipt: ShadowAssetReadyReceipt;
  readonly ensureCalls: ShadowAssetPlan[];
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
    receiptSha256: 'c'.repeat(64),
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

function bootstrapConfig(root = ROOT): BootstrapConfig {
  return {
    runtime: 'vite',
    root,
    port: 5173,
    entryPath: `${root}/src/main.ts`,
    packageName: 'app',
    packageVersion: '1.0.0',
    installDeps: { vite: '7.3.6' },
    packageJson: PACKAGE_JSON,
    seedFiles: {},
  };
}

async function harness(ownerEpoch: string): Promise<Harness> {
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch,
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  owner.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  owner.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
  owner.writeFileSync(`${ROOT}/package-lock.json`, enc.encode(PACKAGE_LOCK));
  owner.writeFileSync(`${ROOT}/node_modules/vite/package.json`, enc.encode('{}\n'));
  const stamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: owner,
    claimIo: installStampClaims,
  });
  const claim = await stamps.demote(ACQUISITION_PROJECT);
  const promoted = await stamps.promote(
    { ...ACQUISITION_PROJECT, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
  if (promoted.status !== 'trusted') throw new Error('fixture failed to trust tree');

  const config: OwnerPackageConfig = {
    cfg: bootstrapConfig(),
    templateId: 'vite-7',
    slug: PROJECT.slug,
    fromScratch: true,
  };
  const assetPlan = plan();
  const readyReceipt = receipt(assetPlan);
  const ensureCalls: ShadowAssetPlan[] = [];
  const state = createAttestedOwnerPackageState({
    initial: config,
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response(null, { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
    runtimeAssets: {
      installer: {
        ensure: async (received) => {
          ensureCalls.push(received);
          return { kind: 'ready', plan: received, receipt: readyReceipt };
        },
        inspectReceipt: async () => null,
      },
      produce: async () => ({ plan: assetPlan }),
    },
  });
  await state.activateAndEnsure(config);
  return { state, owner, config, plan: assetPlan, receipt: readyReceipt, ensureCalls };
}

afterEach(() => {
  resetSyncMirror();
});

describe('owner-private package-tree epoch', () => {
  it('publishes the exact ready plan/receipt and rejects every non-matching project read', async () => {
    const h = await harness('asset-epoch-ready');

    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual({
      project: PROJECT,
      sequence: expect.any(Number),
      readiness: { kind: 'ready', plan: h.plan, receipt: h.receipt },
    });
    expect(h.ensureCalls).toEqual([h.plan]);
    expect(() => h.state.readPackageTreeEpoch({ root: ROOT, slug: 'other-project' })).toThrow(
      /project|slug|epoch/i,
    );
    expect(() =>
      h.state.readPackageTreeEpoch({ root: '/project-copy', slug: PROJECT.slug }),
    ).toThrow(/project|root|epoch/i);
  });

  it.each([
    {
      name: 'manifest',
      intent: { kind: 'write', path: `${ROOT}/package.json` } as const,
      path: `${ROOT}/package.json`,
      bytes: '{"name":"app","dependencies":{"vite":"7.3.6"},"private":true}\n',
    },
    {
      name: 'lockfile',
      intent: { kind: 'write', path: `${ROOT}/package-lock.json` } as const,
      path: `${ROOT}/package-lock.json`,
      bytes: `${PACKAGE_LOCK.trimEnd()} \n`,
    },
  ])('retains the installed-tree epoch for an exact package-only $name edit', async (entry) => {
    const h = await harness(`asset-epoch-package-only-${entry.name}`);
    const before = h.state.readPackageTreeEpoch(PROJECT);

    await h.state.mutations.guardedMutation([entry.intent], async () => {
      h.owner.writeFileSync(entry.path, enc.encode(entry.bytes));
    });

    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual(before);
  });

  it('crosses the tree barrier before the first destructive ingress write', async () => {
    const h = await harness('asset-epoch-tree-ingress');
    const before = h.state.readPackageTreeEpoch(PROJECT);
    let inside: OwnerPackageTreeEpoch | undefined;
    const intent: VfsMutationIntent = {
      kind: 'rm',
      path: `${ROOT}/node_modules/vite`,
    };

    await h.state.mutations.guardedMutation([intent], async () => {
      inside = h.state.readPackageTreeEpoch(PROJECT);
      h.owner.rmSync(`${ROOT}/node_modules/vite`, { recursive: true, force: true });
    });

    expect(inside).toMatchObject({
      project: PROJECT,
      readiness: { kind: 'unavailable' },
    });
    expect(inside!.sequence).toBeGreaterThan(before.sequence);
    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual(inside);
  });

  it('preserves a ready epoch when tree-mutation preflight proves a no-op', async () => {
    const h = await harness('asset-epoch-preflight-noop');
    const before = h.state.readPackageTreeEpoch(PROJECT);
    let mutated = false;

    await expect(
      h.state.mutations.guardedMutation(
        [{ kind: 'rm', path: `${ROOT}/node_modules/vite` }],
        async () => {
          mutated = true;
          return 'mutated';
        },
        async () => ({ status: 'noop', value: 'noop' }),
      ),
    ).resolves.toBe('noop');

    expect(mutated).toBe(false);
    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual(before);
  });

  it('binds beginTreeMutation to one token and advances only once for that token', async () => {
    const h = await harness('asset-epoch-token');
    const token = Object.freeze({ id: 'acquisition-17' });
    const before = h.state.readPackageTreeEpoch(PROJECT);

    h.state.beginTreeMutation(PROJECT, token);
    const first = h.state.readPackageTreeEpoch(PROJECT);
    h.state.beginTreeMutation(PROJECT, token);
    const duplicate = h.state.readPackageTreeEpoch(PROJECT);

    expect(first.readiness).toEqual({ kind: 'unavailable' });
    expect(first.sequence).toBeGreaterThan(before.sequence);
    expect(duplicate).toEqual(first);
    expect(() => h.state.beginTreeMutation({ root: ROOT, slug: 'wrong' }, token)).toThrow(
      /project|token|slug/i,
    );
    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual(first);
  });

  it('publishes project B unavailable before returning its deferred-cold decision', async () => {
    const h = await harness('asset-epoch-project-switch');
    const projectB = Object.freeze({ root: '/project-b', slug: 'project-b' });
    const configB = {
      cfg: bootstrapConfig(projectB.root),
      templateId: 'vite-7-b',
      slug: projectB.slug,
      fromScratch: true,
      firstMaterialization: { kind: 'install' as const },
    };
    h.owner.mkdirSync(projectB.root, { recursive: true });
    h.owner.writeFileSync(`${projectB.root}/package.json`, enc.encode(PACKAGE_JSON));

    await expect(h.state.activateAndEnsure(configB)).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [],
    });
    expect(h.state.readPackageTreeEpoch(projectB)).toMatchObject({
      project: projectB,
      readiness: { kind: 'unavailable' },
    });
    expect(() => h.state.readPackageTreeEpoch(PROJECT)).toThrow(/project|epoch/i);
  });
});

describe('child reservation owns package FIFO settlement', () => {
  it('holds a later tree mutation until the ready reservation commits', async () => {
    const h = await harness('asset-reservation-commit');
    const reservation = await h.state.reserveChildAdmission(PROJECT);
    expect(reservation.readiness).toEqual({
      kind: 'ready',
      plan: h.plan,
      receipt: h.receipt,
    });
    let mutationApplied = false;
    const mutation = h.state.mutations.guardedMutation(
      [{ kind: 'rm', path: `${ROOT}/node_modules` }],
      async () => {
        mutationApplied = true;
      },
    );

    await Promise.resolve();
    expect(mutationApplied).toBe(false);
    reservation.commit();
    await mutation;
    expect(mutationApplied).toBe(true);
  });

  it('keeps quiesce pending until an aborted reservation settles physical exit', async () => {
    const h = await harness('asset-reservation-abort-after-spawn');
    const reservation = await h.state.reserveChildAdmission(PROJECT);
    let resolveExit!: () => void;
    const physicalExit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const original = new Error('supervision attachment failed');
    const aborting = reservation.abortAfterChildSettlement(original, physicalExit);
    let quiesced = false;
    const quiesce = h.state.quiesce().then(() => {
      quiesced = true;
    });

    await Promise.resolve();
    expect(quiesced).toBe(false);
    resolveExit();
    await aborting;
    await quiesce;
    expect(quiesced).toBe(true);
  });

  it('rejects unavailable and cross-project admission with one package-private code', async () => {
    const h = await harness('asset-reservation-unavailable');
    h.state.beginTreeMutation(PROJECT, Object.freeze({ id: 'tree-replace' }));

    await expect(h.state.reserveChildAdmission(PROJECT)).rejects.toMatchObject({
      name: 'PackageTreeUnattestedError',
      code: 'EUNATTESTEDPACKAGETREE',
    });
    await expect(
      h.state.reserveChildAdmission({ root: ROOT, slug: 'other' }),
    ).rejects.toMatchObject({
      name: 'PackageTreeUnattestedError',
      code: 'EUNATTESTEDPACKAGETREE',
    });
  });
});
