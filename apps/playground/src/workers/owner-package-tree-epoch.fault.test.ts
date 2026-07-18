import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  EMPTY_SHADOW_ASSET_PLAN,
  RegistryClient,
  type ShadowAssetInstaller,
  type ShadowAssetManager,
  type ShadowAssetPlan,
  type ShadowAssetReadyReceipt,
  type ShadowAssetSource,
  type ShadowAssetStorage,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
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
import { type OwnerChildAdmissionHandle, admitOwnerChild } from './owner-child-admission.ts';
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
    options?: Readonly<{ signal?: AbortSignal }>,
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
  readonly receipt?: ShadowAssetReadyReceipt;
  readonly ensureCalls: ShadowAssetPlan[];
}

interface HarnessOptions {
  readonly assetPlan?: ShadowAssetPlan;
  readonly installer?: ShadowAssetInstaller;
  readonly expectedActivationFailure?: unknown;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
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

async function harness(ownerEpoch: string, harnessOptions: HarnessOptions = {}): Promise<Harness> {
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
  const assetPlan = harnessOptions.assetPlan ?? plan();
  const readyReceipt = assetPlan.assets.length === 0 ? undefined : receipt(assetPlan);
  const ensureCalls: ShadowAssetPlan[] = [];
  const installer: ShadowAssetInstaller = harnessOptions.installer ?? {
    ensure: async (received) => {
      if (!readyReceipt) return { kind: 'not-required', plan: received };
      return { kind: 'ready', plan: received, receipt: readyReceipt };
    },
    inspectReceipt: async () => null,
  };
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
        ensure: async (received, options) => {
          ensureCalls.push(received);
          return installer.ensure(received, options);
        },
        inspectReceipt: (requiredSetDigest) => installer.inspectReceipt(requiredSetDigest),
      },
      produce: async () => ({ plan: assetPlan }),
    },
  });
  let activationFailed = false;
  try {
    await state.activateAndEnsure(config);
  } catch (error) {
    if (error !== harnessOptions.expectedActivationFailure) throw error;
    activationFailed = true;
  }
  if (harnessOptions.expectedActivationFailure !== undefined && !activationFailed) {
    throw new Error('fixture expected activation to fail');
  }
  return {
    state,
    owner,
    config,
    plan: assetPlan,
    ...(readyReceipt === undefined ? {} : { receipt: readyReceipt }),
    ensureCalls,
  };
}

function reserveChildAdmissionWithSignal(
  state: OwnerPackageState,
  project: Readonly<{ root: string; slug: string }>,
  signal: AbortSignal,
): ReturnType<OwnerPackageState['reserveChildAdmission']> {
  return state.reserveChildAdmission(project, { signal });
}

async function realManagerFlight(assetPlan: ShadowAssetPlan): Promise<{
  readonly manager: ShadowAssetManager;
  readonly entered: Promise<void>;
  release(): void;
}> {
  const asset = assetPlan.assets[0];
  if (!asset) throw new Error('fixture expected one runtime asset');
  const inner = createMemoryShadowAssetStorage();
  const wasm = new Uint8Array(
    await readFile(new URL('../../node_modules/esbuild-wasm/esbuild.wasm', import.meta.url)),
  );
  await inner.write({ kind: 'object', sha256: asset.memberSha256 }, wasm);
  const firstSubstitution = assetPlan.substitutions[0];
  if (!firstSubstitution) throw new Error('fixture expected one runtime substitution');
  const receiptPayload = {
    assets: assetPlan.assets.map((candidate) => ({
      fillCache: 'network' as const,
      fillTransport: 'standard' as const,
      id: candidate.id,
      member: candidate.member,
      memberSha256: candidate.memberSha256,
      memberSize: candidate.memberSize,
      source: {
        integrity: candidate.source.integrity,
        name: candidate.source.name,
        version: candidate.source.version,
      },
    })),
    catalog: {
      digest: firstSubstitution.catalog.digest,
      id: firstSubstitution.catalog.id,
    },
    requiredSetDigest: assetPlan.requiredSetDigest,
    schema: 1 as const,
    storageClass: inner.storageClass,
    substitutions: assetPlan.substitutions.map((substitution) => ({
      builtin: substitution.builtin,
      catalog: {
        digest: substitution.catalog.digest,
        id: substitution.catalog.id,
      },
      publicName: substitution.publicName,
      requestedRange: substitution.requestedRange,
      resolvedPublicVersion: substitution.resolvedPublicVersion,
      runtimeAdapterId: substitution.runtimeAdapterId,
      substitutionId: substitution.substitutionId,
    })),
  };
  const receiptBytes = enc.encode(JSON.stringify(receiptPayload));
  const receiptSha256 = createHash('sha256').update(receiptBytes).digest('hex');
  await inner.write({ kind: 'receipt', sha256: receiptSha256 }, receiptBytes);
  await inner.write(
    { kind: 'ready', requiredSetDigest: assetPlan.requiredSetDigest },
    enc.encode(
      JSON.stringify({
        receiptSha256,
        requiredSetDigest: assetPlan.requiredSetDigest,
        schema: 1,
      }),
    ),
  );
  const entered = deferred<void>();
  const released = deferred<void>();
  const storage: ShadowAssetStorage = {
    storageClass: inner.storageClass,
    read: async (entry) => {
      if (entry.kind === 'object' && entry.sha256 === asset.memberSha256) {
        entered.resolve();
        await released.promise;
      }
      return inner.read(entry);
    },
    write: (entry, bytes) => inner.write(entry, bytes),
    remove: (entry) => inner.remove(entry),
    inspect: () => inner.inspect(),
    clear: () => inner.clear(),
    close: () => inner.close(),
  };
  const source: ShadowAssetSource = {
    acquire: async () => {
      throw new Error('verified object fixture unexpectedly acquired source bytes');
    },
    close: async () => undefined,
  };
  return {
    manager: createShadowAssetManager({ storage, source }),
    entered: entered.promise,
    release: () => released.resolve(),
  };
}

function pendingEpochInstaller(
  manager: ShadowAssetManager,
  initialFailure: Error,
  entered?: Deferred<void>,
): ShadowAssetInstaller {
  let calls = 0;
  return {
    ensure: async (assetPlan, options) => {
      calls += 1;
      if (calls === 1) throw initialFailure;
      entered?.resolve();
      return manager.installer.ensure(assetPlan, options);
    },
    inspectReceipt: (requiredSetDigest) => manager.installer.inspectReceipt(requiredSetDigest),
  };
}

class TerminationFaultChild implements OwnerChildAdmissionHandle {
  #exit: (() => void) | undefined;

  constructor(
    private readonly killOutcome: 'throw' | 'false',
    private readonly killFailure: Error,
    private readonly killAttempted: Deferred<void>,
  ) {}

  on(_event: 'exit', _listener: (...args: unknown[]) => void): unknown {
    return this;
  }

  once(_event: 'exit', listener: (...args: unknown[]) => void): unknown {
    this.#exit = listener;
    return this;
  }

  kill(_signal?: string): unknown {
    this.killAttempted.resolve();
    if (this.killOutcome === 'throw') throw this.killFailure;
    return false;
  }

  exit(): void {
    this.#exit?.();
  }
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

  it.each(['throw', 'false'] as const)(
    'keeps mutation and quiesce behind physical exit when child termination returns %s',
    async (killOutcome) => {
      const h = await harness(`asset-reservation-termination-${killOutcome}`);
      const supervisionFailure = new Error('supervision attachment failed');
      const killFailure = new Error('child termination transport failed');
      const killAttempted = deferred<void>();
      const child = new TerminationFaultChild(killOutcome, killFailure, killAttempted);
      let admissionSettled = false;
      const admission = admitOwnerChild({
        authority: {
          reserve: (options) => h.state.reserveChildAdmission(PROJECT, options),
          runtimeReader: () => ({
            readVerified: async () => new Uint8Array(),
          }),
        },
        spawn: () => child,
        supervise: () => {
          throw supervisionFailure;
        },
      });
      const outcome = admission
        .catch((error: unknown) => error)
        .then((error) => {
          admissionSettled = true;
          return error;
        });
      await killAttempted.promise;

      let mutationApplied = false;
      const mutation = h.state.mutations.guardedMutation(
        [{ kind: 'write', path: `${ROOT}/package.json` }],
        async () => {
          mutationApplied = true;
        },
      );
      let quiesced = false;
      const quiesce = h.state.quiesce().then(() => {
        quiesced = true;
      });
      const beforePhysicalExit = await Promise.race([
        Promise.all([outcome, mutation, quiesce]).then(() => 'released' as const),
        new Promise<'held'>((resolve) => setTimeout(resolve, 30, 'held')),
      ]);

      child.exit();
      const error = await outcome;
      await mutation;
      await quiesce;

      expect(beforePhysicalExit).toBe('held');
      expect(mutationApplied).toBe(true);
      expect(quiesced).toBe(true);
      expect(admissionSettled).toBe(true);
      expect(error).toBeInstanceOf(AggregateError);
      const errors = (error as AggregateError).errors;
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBe(supervisionFailure);
      if (killOutcome === 'throw') {
        expect(errors[1]).toBe(killFailure);
      } else {
        expect(errors[1]).toEqual(new Error('owner child closed without an exit event'));
      }
    },
  );

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

describe('child reservation cancellation fault matrix', () => {
  it.each([
    { name: 'ready', assetPlan: undefined },
    { name: 'not-required', assetPlan: EMPTY_SHADOW_ASSET_PLAN },
  ])('rejects a pre-aborted $name reservation without changing its epoch', async (entry) => {
    const h = await harness(`asset-reservation-pre-abort-${entry.name}`, {
      ...(entry.assetPlan === undefined ? {} : { assetPlan: entry.assetPlan }),
    });
    const before = h.state.readPackageTreeEpoch(PROJECT);
    const abort = new AbortController();
    abort.abort();

    const outcome = await reserveChildAdmissionWithSignal(h.state, PROJECT, abort.signal).then(
      (reservation) => {
        reservation.commit();
        return { kind: 'resolved' as const };
      },
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    await h.state.quiesce();

    expect(outcome).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } });
    expect(h.state.readPackageTreeEpoch(PROJECT)).toEqual(before);
  });

  it('rejects a pre-aborted pending reservation before admitting real manager work', async () => {
    const assetPlan = plan();
    const flight = await realManagerFlight(assetPlan);
    const initialFailure = new Error('fixture leaves runtime-asset readiness pending');
    const h = await harness('asset-reservation-pre-abort-pending', {
      assetPlan,
      installer: pendingEpochInstaller(flight.manager, initialFailure),
      expectedActivationFailure: initialFailure,
    });
    const abort = new AbortController();
    abort.abort();
    const reservation = reserveChildAdmissionWithSignal(h.state, PROJECT, abort.signal);
    const settlement = reservation.then(
      (held) => ({ kind: 'resolved' as const, held }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    const first = await Promise.race([
      settlement,
      flight.entered.then(() => ({ kind: 'manager-work-entered' as const })),
    ]);

    flight.release();
    const eventual = await settlement;
    if (eventual.kind === 'resolved') eventual.held.commit();
    await h.state.quiesce();
    const finalEpoch = h.state.readPackageTreeEpoch(PROJECT);
    await flight.manager.close();

    expect(first).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } });
    expect(finalEpoch.readiness).toEqual({ kind: 'pending', plan: assetPlan });
  });

  it('cancels only the pending child waiter while a same-plan manager waiter completes', async () => {
    const assetPlan = plan();
    const flight = await realManagerFlight(assetPlan);
    const initialFailure = new Error('fixture leaves runtime-asset readiness pending');
    const childEnsureEntered = deferred<void>();
    const h = await harness('asset-reservation-mid-flight-abort', {
      assetPlan,
      installer: pendingEpochInstaller(flight.manager, initialFailure, childEnsureEntered),
      expectedActivationFailure: initialFailure,
    });
    const survivor = flight.manager.installer.ensure(assetPlan);
    await flight.entered;
    const abort = new AbortController();
    const reservation = reserveChildAdmissionWithSignal(h.state, PROJECT, abort.signal);
    const settlement = reservation.then(
      (held) => ({ kind: 'resolved' as const, held }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    await childEnsureEntered.promise;
    let mutationApplied = false;
    const mutation = h.state.mutations.guardedMutation(
      [{ kind: 'write', path: `${ROOT}/package.json` }],
      async () => {
        mutationApplied = true;
      },
    );
    let quiesced = false;
    const quiesce = h.state.quiesce().then(() => {
      quiesced = true;
    });

    abort.abort();
    const queueProgress = await Promise.race([
      Promise.all([mutation, quiesce]).then(() => 'progressed' as const),
      new Promise<'stalled'>((resolve) => setTimeout(resolve, 1_000, 'stalled')),
    ]);
    const beforeProducerRelease = {
      mutationApplied,
      quiesced,
      epoch: h.state.readPackageTreeEpoch(PROJECT),
    };
    const childOutcomeBeforeRelease = await Promise.race([
      settlement,
      Promise.resolve({ kind: 'still-pending' as const }),
    ]);

    flight.release();
    const eventual = await settlement;
    if (eventual.kind === 'resolved') eventual.held.commit();
    const survivorResult = await survivor;
    await mutation;
    await quiesce;
    const finalEpoch = h.state.readPackageTreeEpoch(PROJECT);
    await flight.manager.close();

    expect(childOutcomeBeforeRelease).toMatchObject({
      kind: 'rejected',
      error: { name: 'AbortError' },
    });
    expect(queueProgress).toBe('progressed');
    expect(beforeProducerRelease).toEqual({
      mutationApplied: true,
      quiesced: true,
      epoch: expect.objectContaining({ readiness: { kind: 'pending', plan: assetPlan } }),
    });
    expect(survivorResult).toMatchObject({ kind: 'ready', plan: assetPlan });
    expect(finalEpoch.readiness).toEqual({ kind: 'pending', plan: assetPlan });
  });
});
