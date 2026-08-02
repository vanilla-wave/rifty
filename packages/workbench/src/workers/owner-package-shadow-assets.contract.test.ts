import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  type InstallOptions,
  type InstallResult,
  type Packument,
  RegistryClient,
  type VersionManifest,
  install,
} from '@riftydev/npm-client';
import {
  type PackageTreeShadowAssetBoundary,
  SHADOW_ASSET_PORT_CAPABILITY,
  type ShadowAssetPlan,
  type ShadowAssetReadySet,
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createShadowAssetPortClient,
  shadowAssetPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import { Shell } from '@riftydev/shell';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const requireFromRegistry = createRequire(
  new URL('../../../../tools/shadow-registry/package.json', import.meta.url),
);
const assetBytes = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);
const assetSha256 = createHash('sha256').update(assetBytes).digest('hex');
const ROOTS = ['/projects/first', '/projects/second'] as const;
const sassFixtureRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);

interface SassRegistryFixture {
  readonly name: string;
  readonly version: string;
  readonly dist: { readonly integrity: string };
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bin: Readonly<Record<string, string>>;
}

interface SassClosureFixture {
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly dependencies: Readonly<Record<string, string>>;
    readonly integrity: string;
  }[];
}

interface SassRegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

const sassRegistryFixture = JSON.parse(
  await readFile(new URL('sass-1.100.0-registry.json', sassFixtureRoot), 'utf8'),
) as SassRegistryFixture;
const sassClosureFixture = JSON.parse(
  await readFile(new URL('sass-1.100.0-closure.json', sassFixtureRoot), 'utf8'),
) as SassClosureFixture;

function fixtureTarballUrl(name: string): string {
  return `fixture:${encodeURIComponent(name)}`;
}

const sassRegistryEntries = new Map<string, SassRegistryEntry>(
  await Promise.all(
    [
      {
        name: sassRegistryFixture.name,
        version: sassRegistryFixture.version,
        manifest: {
          name: sassRegistryFixture.name,
          version: sassRegistryFixture.version,
          dependencies: { ...sassRegistryFixture.dependencies },
          optionalDependencies: { ...sassRegistryFixture.optionalDependencies },
          peerDependencies: { ...sassRegistryFixture.peerDependencies },
          bin: { ...sassRegistryFixture.bin },
          dist: {
            integrity: sassRegistryFixture.dist.integrity,
            tarball: fixtureTarballUrl(sassRegistryFixture.name),
          },
        } satisfies VersionManifest,
      },
      ...sassClosureFixture.packages.map((fixture) => ({
        name: fixture.name,
        version: fixture.version,
        manifest: {
          name: fixture.name,
          version: fixture.version,
          dependencies: { ...fixture.dependencies },
          dist: {
            integrity: fixture.integrity,
            tarball: fixtureTarballUrl(fixture.name),
          },
        } satisfies VersionManifest,
      })),
    ].map(async ({ name, version, manifest }) => {
      const tarball = new Uint8Array(
        await readFile(new URL(`${name}-${version}.tgz`, sassFixtureRoot)),
      );
      return [name, { manifest, tarball }] as const;
    }),
  ),
);

class RejectingRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/must-not-read', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    throw new Error(`synthetic esbuild must not read registry metadata for ${name}`);
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    throw new Error(`synthetic esbuild must not read registry tarball ${url}`);
  }
}

class SassFixtureRegistry extends RegistryClient {
  readonly packuments: string[] = [];
  readonly tarballs: string[] = [];

  constructor() {
    super({ baseUrl: '/sass-fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packuments.push(name);
    const entry = sassRegistryEntries.get(name);
    if (entry === undefined) {
      if (name === 'sass-embedded') {
        throw new Error(
          'missing Sass shadow recipe: owner attempted sass-embedded registry metadata',
        );
      }
      throw new Error(`unexpected Sass fixture packument ${name}`);
    }
    return {
      name,
      'dist-tags': { latest: entry.manifest.version },
      versions: { [entry.manifest.version]: entry.manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballs.push(url);
    const name = decodeURIComponent(url.slice('fixture:'.length));
    const entry = sassRegistryEntries.get(name);
    if (entry === undefined) throw new Error(`unexpected Sass fixture tarball ${url}`);
    return entry.tarball.slice();
  }
}

function packageConfig(root: string, name: string): OwnerPackageConfig {
  const packageJson = `${JSON.stringify({
    name,
    version: '1.0.0',
    dependencies: { esbuild: '^0.28.0' },
  })}\n`;
  return {
    cfg: {
      runtime: 'vite',
      root,
      port: 5173,
      entryPath: `${root}/src/main.ts`,
      packageName: name,
      packageVersion: '1.0.0',
      installDeps: { esbuild: '^0.28.0' },
      packageJson,
      seedFiles: {},
    },
    templateId: 'esbuild-contract',
    slug: name,
    fromScratch: true,
  };
}

function sassPackageConfig(root: string): OwnerPackageConfig {
  const packageJson = `${JSON.stringify({
    name: 'sass-zero-assets',
    version: '1.0.0',
    dependencies: { 'sass-embedded': '1.100.0' },
  })}\n`;
  return {
    cfg: {
      runtime: 'node-cli',
      root,
      entryPath: `${root}/main.mjs`,
      packageName: 'sass-zero-assets',
      packageVersion: '1.0.0',
      installDeps: { 'sass-embedded': '1.100.0' },
      packageJson,
      seedFiles: {},
    },
    templateId: 'sass-zero-asset-contract',
    slug: 'sass-zero-assets',
    fromScratch: true,
  };
}

afterEach(resetSyncMirror);

it('freezes exact runtime plans and reuses one ready asset across projects', async () => {
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-shadow-consumer-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  const configs = ROOTS.map((root, index) => packageConfig(root, `app-${String(index + 1)}`));
  for (const config of configs) {
    owner.mkdirSync(config.cfg.root, { recursive: true });
    owner.writeFileSync(
      `${config.cfg.root}/package.json`,
      new TextEncoder().encode(config.cfg.packageJson),
    );
  }

  const baseStorage = createMemoryShadowAssetStorage();
  let objectWrites = 0;
  const storage: Parameters<typeof createOriginExclusiveShadowAssetManager>[0]['storage'] = {
    storageClass: baseStorage.storageClass,
    read: (entry) => baseStorage.read(entry),
    write: async (entry, bytes) => {
      if (entry.kind === 'object') {
        objectWrites += 1;
      }
      await baseStorage.write(entry, bytes);
    },
    remove: (entry) => baseStorage.remove(entry),
    close: () => baseStorage.close(),
  };
  let acquisitions = 0;
  const manager = createOriginExclusiveShadowAssetManager({
    storage,
    source: {
      acquire: async () => {
        acquisitions += 1;
        return assetBytes.slice();
      },
    },
  });

  const ensuredPlans: ShadowAssetPlan[] = [];
  const readyByPlan = new Map<ShadowAssetPlan, ShadowAssetReadySet>();
  const servedReady: ShadowAssetReadySet[] = [];
  const shadowAssets: PackageTreeShadowAssetBoundary = Object.freeze({
    async ensure(plan: ShadowAssetPlan) {
      ensuredPlans.push(plan);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.substitutions)).toBe(true);
      const ready = await manager.ensure(plan);
      readyByPlan.set(plan, ready);
      return ready;
    },
    serve(ready: ShadowAssetReadySet, port: MessagePort) {
      servedReady.push(ready);
      return manager.serve(ready, port);
    },
  });

  const plansByRoot = new Map<string, ShadowAssetPlan>();
  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RejectingRegistry(),
    shadowAssets,
    install: async (arg1) => {
      if (typeof arg1 === 'string') throw new Error('owner install must use InstallOptions');
      const options: InstallOptions = arg1;
      const result = await install(options);
      plansByRoot.set(options.cwd, shadowAssetPlanForInstallResult(result));
      return result;
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  for (const config of configs) await state.activateAndEnsure(config);

  expect(acquisitions).toBe(1);
  expect(objectWrites).toBe(1);
  expect(ensuredPlans).toHaveLength(2);

  for (const root of ROOTS) {
    const exactPlan = plansByRoot.get(root);
    if (!exactPlan) throw new Error(`installer plan missing for ${root}`);
    expect(ensuredPlans.some((plan) => plan === exactPlan)).toBe(true);
    const exactReady = readyByPlan.get(exactPlan);
    if (!exactReady) throw new Error(`manager ready set missing for ${root}`);

    const reservation = await state.reserveChildAdmission(root);
    expect(reservation.snapshot.ready).toBe(exactReady);
    expect(servedReady.at(-1)).toBe(exactReady);
    const port = reservation.snapshot.capabilityPorts[SHADOW_ASSET_PORT_CAPABILITY];
    if (!(port instanceof MessagePort)) throw new Error(`shadow capability missing for ${root}`);
    if (root === ROOTS[0]) {
      const client = createShadowAssetPortClient(port, { deadlineMs: 1_000 });
      await client.ready;
      const servedBytes = await client.read(exactPlan.assets[0]!.id);
      expect(createHash('sha256').update(servedBytes).digest('hex')).toBe(assetSha256);
      client.dispose();
    }
    reservation.snapshot.dispose();
    reservation.commit();
  }

  await manager.close();
});

it('keeps the registry-backed Sass substitution outside the asset manager and store', async () => {
  const root = '/projects/sass-zero-assets';
  const config = sassPackageConfig(root);
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-sass-zero-assets-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  owner.mkdirSync(root, { recursive: true });
  owner.writeFileSync(`${root}/package.json`, new TextEncoder().encode(config.cfg.packageJson));

  const shadowAssets: PackageTreeShadowAssetBoundary = Object.freeze({
    async ensure(plan: ShadowAssetPlan) {
      throw new Error(
        `Sass zero-asset plan must not enter asset manager ensure: ${plan.requiredSetDigest}`,
      );
    },
    serve(_ready: ShadowAssetReadySet, _port: MessagePort) {
      throw new Error('Sass zero-asset plan must not create an asset MessagePort server');
    },
  });
  const registry = new SassFixtureRegistry();
  let installPlan: ShadowAssetPlan | undefined;
  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry,
    shadowAssets,
    install: async (arg1) => {
      if (typeof arg1 === 'string') throw new Error('owner install must use InstallOptions');
      const result = await install(arg1);
      installPlan = shadowAssetPlanForInstallResult(result);
      return result;
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.activateAndEnsure(config);
  if (installPlan === undefined) throw new Error('owner Sass install plan was not observed');
  expect(installPlan.assets).toEqual([]);
  expect(installPlan.bindings).toEqual([]);
  expect(installPlan.substitutions).toHaveLength(1);
  expect(installPlan.substitutions[0]).toMatchObject({
    substitutionId: 'rifty.shadow-substitution.sass-embedded.v2',
    acquisition: { kind: 'registry', name: 'sass', version: '1.100.0' },
    materialization: {
      installPath: 'node_modules/sass-embedded',
      name: 'sass-embedded',
      version: '1.100.0',
    },
  });
  expect(registry.packuments).not.toContain('sass-embedded');

  const reservation = await state.reserveChildAdmission(root);
  try {
    expect(reservation.snapshot.ready).toBeNull();
    expect(reservation.snapshot.capabilityPorts).toEqual({});
  } finally {
    reservation.snapshot.dispose();
    reservation.commit();
  }
});

// Fault class: concurrent-same-key. Sass has no asset-manager carrier, but its
// real installer still enters the same owner FIFO exactly once per project.
it('physically excludes same-project Sass installs while the first lockfile commit is parked', async () => {
  const root = '/projects/sass-fifo';
  const config = sassPackageConfig(root);
  const facadePaths = [
    'dist/bin/sass.js',
    'dist/lib/index.js',
    'dist/lib/index.mjs',
    'package.json',
  ] as const;
  const stableMaterializedPaths = [
    ...facadePaths.map((path) => `node_modules/sass-embedded/${path}`),
    'node_modules/.bin/sass',
  ] as const;
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-sass-physical-exclusion-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  owner.mkdirSync(root, { recursive: true });
  owner.writeFileSync(`${root}/package.json`, new TextEncoder().encode(config.cfg.packageJson));

  const shadowAssets: PackageTreeShadowAssetBoundary = Object.freeze({
    async ensure(plan: ShadowAssetPlan) {
      throw new Error(`Sass FIFO must not enter asset ensure: ${plan.requiredSetDigest}`);
    },
    serve(_ready: ShadowAssetReadySet, _port: MessagePort) {
      throw new Error('Sass FIFO must not create an asset MessagePort server');
    },
  });
  const registry = new SassFixtureRegistry();
  const projectVfs = new SyncMirrorVfs();
  let markFirstAtLock!: () => void;
  const firstAtLock = new Promise<void>((resolve) => {
    markFirstAtLock = resolve;
  });
  let openFirstLockGate!: () => void;
  const firstLockGate = new Promise<void>((resolve) => {
    openFirstLockGate = resolve;
  });
  let gateOpen = false;
  const releaseFirst = (): void => {
    if (gateOpen) return;
    gateOpen = true;
    openFirstLockGate();
  };
  const writeAttempts: Array<{ readonly install: number; readonly path: string }> = [];
  const results: InstallResult[] = [];
  let coreEntries = 0;
  let active = 0;
  let maxActive = 0;

  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: projectVfs,
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry,
    shadowAssets,
    install: async (arg1) => {
      if (typeof arg1 === 'string') throw new Error('owner install must use InstallOptions');
      const options: InstallOptions = arg1;
      const installOrdinal = ++coreEntries;
      active += 1;
      maxActive = Math.max(maxActive, active);
      let parked = false;
      const observedVfs = new Proxy(options.vfs, {
        get(target, property) {
          if (property === 'writeFile') {
            return async (...args: Parameters<InstallOptions['vfs']['writeFile']>) => {
              const [path] = args;
              writeAttempts.push({ install: installOrdinal, path });
              if (installOrdinal === 1 && path === `${root}/package-lock.json` && !parked) {
                parked = true;
                markFirstAtLock();
                await firstLockGate;
              }
              return target.writeFile(...args);
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      try {
        const result = await install({ ...options, vfs: observedVfs });
        results.push(result);
        return result;
      } finally {
        active -= 1;
      }
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.transition(config);
  const shell = new Shell({ cwd: root });
  shell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0),
  );
  const first = shell.run('npm install');
  let second: ReturnType<typeof shell.run> | undefined;
  try {
    await Promise.race([
      firstAtLock,
      first.then((outcome) => {
        throw new Error(
          `first Sass install exited before its lock write: ${outcome.exitCode} ${outcome.stdout}`,
        );
      }),
    ]);
    expect(coreEntries).toBe(1);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    expect(owner.existsSync(`${root}/package-lock.json`)).toBe(false);
    const revisionAtPark = owner.treeRevision;
    const attemptsAtPark = [...writeAttempts];
    const materializedAtPark = await Promise.all(
      stableMaterializedPaths.map((path) => projectVfs.readFile(`${root}/${path}`)),
    );

    second = shell.run('npm install');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(coreEntries).toBe(1);
    expect(active).toBe(1);
    expect(owner.treeRevision).toBe(revisionAtPark);
    expect(writeAttempts).toEqual(attemptsAtPark);

    releaseFirst();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome.exitCode, firstOutcome.stdout).toBe(0);
    expect(secondOutcome.exitCode, secondOutcome.stdout).toBe(0);
    await state.quiesce();

    expect(coreEntries).toBe(2);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    expect(results).toHaveLength(2);
    const [firstResult, secondResult] = results;
    if (!firstResult || !secondResult) throw new Error('both Sass FIFO results are required');
    expect(secondResult.lockfile).toEqual(firstResult.lockfile);

    const persistedLockText = await projectVfs.readFileText(`${root}/package-lock.json`);
    expect(persistedLockText).toBe(JSON.stringify(firstResult.lockfile, null, 2));
    const lockfile = JSON.parse(persistedLockText) as InstallResult['lockfile'];
    expect(lockfile).toEqual(firstResult.lockfile);
    expect(lockfile).toEqual(secondResult.lockfile);
    expect(Object.keys(lockfile.packages).sort()).toEqual([
      '',
      'node_modules/chokidar',
      'node_modules/immutable',
      'node_modules/readdirp',
      'node_modules/sass',
      'node_modules/sass-embedded',
      'node_modules/source-map-js',
    ]);
    expect(lockfile.packages['node_modules/sass']).toEqual({
      version: '1.100.0',
      resolved: fixtureTarballUrl('sass'),
      integrity: sassRegistryFixture.dist.integrity,
      dependencies: { ...sassRegistryFixture.dependencies },
    });
    expect(lockfile.packages['node_modules/sass-embedded']).toEqual({
      version: '1.100.0',
      bin: { sass: 'dist/bin/sass.js' },
      riftyShadowRecipe: 'rifty.shadow-substitution.sass-embedded.v2',
    });

    const materializedAfterBoth = await Promise.all(
      stableMaterializedPaths.map((path) => projectVfs.readFile(`${root}/${path}`)),
    );
    expect(materializedAfterBoth).toEqual(materializedAtPark);
    expect(new TextDecoder().decode(materializedAfterBoth.at(-1))).toBe(
      "#!/usr/bin/env node\nimport('../sass-embedded/dist/bin/sass.js');\n",
    );
    const fileFacts = facadePaths.map((path, index) => {
      const bytes = materializedAfterBoth[index];
      if (!bytes) throw new Error(`Sass FIFO materialization bytes missing for ${path}`);
      return {
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
      };
    });
    expect(lockfile.rifty?.shadowSubstitutions).toEqual({
      protocol: 'rifty.shadow-substitutions/v2',
      applied: [
        {
          catalog: {
            id: 'rifty.shadow-substitutions.builtin.v2',
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
          substitutionId: 'rifty.shadow-substitution.sass-embedded.v2',
          recipeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          trigger: {
            name: 'sass-embedded',
            requestedRange: '1.100.0',
            version: '1.100.0',
          },
          acquisition: {
            kind: 'registry',
            name: 'sass',
            version: '1.100.0',
            resolved: fixtureTarballUrl('sass'),
            integrity: sassRegistryFixture.dist.integrity,
            dependencies: { ...sassRegistryFixture.dependencies },
            optionalDependencies: {},
            peerDependencies: {},
            bundleDependencies: [],
            bundled: [],
          },
          materialization: {
            installPath: 'node_modules/sass-embedded',
            name: 'sass-embedded',
            version: '1.100.0',
            files: fileFacts,
            bin: { sass: 'dist/bin/sass.js' },
          },
        },
      ],
    });
    for (const file of fileFacts) {
      const bytes = await projectVfs.readFile(`${root}/node_modules/sass-embedded/${file.path}`);
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    expect(registry.packuments).not.toContain('sass-embedded');
    expect(registry.packuments).not.toContain('@parcel/watcher');
  } finally {
    releaseFirst();
    await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
  }
});

// Fault class: concurrent-same-key. The owner FIFO must physically exclude the
// second real installer, not merely correlate its eventual result.
it('physically excludes same-project installs while the first lockfile commit is parked', async () => {
  const root = '/projects/fifo';
  const config = packageConfig(root, 'fifo-app');
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-shadow-physical-exclusion-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  owner.mkdirSync(root, { recursive: true });
  owner.writeFileSync(`${root}/package.json`, new TextEncoder().encode(config.cfg.packageJson));

  const manager = createOriginExclusiveShadowAssetManager({
    storage: createMemoryShadowAssetStorage(),
    source: { acquire: async () => assetBytes.slice() },
  });
  const projectVfs = new SyncMirrorVfs();
  let markFirstAtLock!: () => void;
  const firstAtLock = new Promise<void>((resolve) => {
    markFirstAtLock = resolve;
  });
  let openFirstLockGate!: () => void;
  const firstLockGate = new Promise<void>((resolve) => {
    openFirstLockGate = resolve;
  });
  let gateOpen = false;
  const releaseFirst = (): void => {
    if (gateOpen) return;
    gateOpen = true;
    openFirstLockGate();
  };
  const writeAttempts: Array<{ readonly install: number; readonly path: string }> = [];
  const results: Array<{ readonly install: number; readonly result: InstallResult }> = [];
  const substitutionReports: Array<{ readonly install: number; readonly line: string }> = [];
  let coreEntries = 0;
  let active = 0;
  let maxActive = 0;

  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: projectVfs,
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RejectingRegistry(),
    shadowAssets: manager,
    install: async (arg1) => {
      if (typeof arg1 === 'string') throw new Error('owner install must use InstallOptions');
      const options: InstallOptions = arg1;
      const installOrdinal = ++coreEntries;
      active += 1;
      maxActive = Math.max(maxActive, active);
      let parked = false;
      const observedVfs = new Proxy(options.vfs, {
        get(target, property) {
          if (property === 'writeFile') {
            return async (...args: Parameters<InstallOptions['vfs']['writeFile']>) => {
              const [path] = args;
              writeAttempts.push({ install: installOrdinal, path });
              if (installOrdinal === 1 && path === `${root}/package-lock.json` && !parked) {
                parked = true;
                markFirstAtLock();
                await firstLockGate;
              }
              return target.writeFile(...args);
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const ownerReporter = options.onSubstitution;
      try {
        const result = await install({
          ...options,
          vfs: observedVfs,
          onSubstitution: (line) => {
            substitutionReports.push({ install: installOrdinal, line });
            ownerReporter?.(line);
          },
        });
        results.push({ install: installOrdinal, result });
        return result;
      } finally {
        active -= 1;
      }
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.transition(config);
  const shell = new Shell({ cwd: root });
  shell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0),
  );
  const first = shell.run('npm install');
  let second: ReturnType<typeof shell.run> | undefined;
  try {
    await firstAtLock;
    expect(coreEntries).toBe(1);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    expect(owner.existsSync(`${root}/package-lock.json`)).toBe(false);
    expect(substitutionReports).toEqual([]);
    const revisionAtPark = owner.treeRevision;
    const attemptsAtPark = [...writeAttempts];

    second = shell.run('npm install');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(coreEntries).toBe(1);
    expect(owner.treeRevision).toBe(revisionAtPark);
    expect(writeAttempts).toEqual(attemptsAtPark);
    expect(substitutionReports).toEqual([]);

    const materializedAtPark = await Promise.all(
      [
        'node_modules/esbuild/bin/esbuild',
        'node_modules/esbuild/lib/main.cjs',
        'node_modules/esbuild/package.json',
        'node_modules/.bin/esbuild',
      ].map((path) => projectVfs.readFile(`${root}/${path}`)),
    );
    releaseFirst();
    const firstOutcome = await first;
    const secondOutcome = await second;
    expect(firstOutcome.exitCode).toBe(0);
    expect(secondOutcome.exitCode).toBe(0);
    await state.quiesce();

    expect(coreEntries).toBe(2);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    expect(results.map(({ install: ordinal }) => ordinal)).toEqual([1, 2]);
    expect(substitutionReports).toEqual([
      {
        install: 1,
        line: 'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
      },
      {
        install: 2,
        line: 'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
      },
    ]);
    expect(firstOutcome.stdout).toContain(substitutionReports[0]!.line);
    expect(secondOutcome.stdout).toContain(substitutionReports[1]!.line);
    const [firstResult, secondResult] = results.map(({ result }) => result);
    expect(secondResult?.lockfile).toEqual(firstResult?.lockfile);

    const lockfile = JSON.parse(
      await projectVfs.readFileText(`${root}/package-lock.json`),
    ) as InstallResult['lockfile'];
    expect(lockfile).toEqual(firstResult?.lockfile);
    const shadowTrace = lockfile.rifty?.shadowSubstitutions as unknown as {
      readonly protocol?: string;
      readonly applied?: readonly {
        readonly materialization?: { readonly bin?: unknown };
      }[];
    };
    expect
      .soft(shadowTrace?.protocol, 'owner FIFO committed shadow protocol')
      .toBe('rifty.shadow-substitutions/v2');
    const appliedTrace = shadowTrace?.applied?.[0];
    expect.soft(appliedTrace, 'owner FIFO committed esbuild recipe').toMatchObject({
      catalog: {
        id: 'rifty.shadow-substitutions.builtin.v2',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      substitutionId: 'rifty.shadow-substitution.esbuild.v2',
      recipeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
      acquisition: { kind: 'synthetic' },
      materialization: {
        installPath: 'node_modules/esbuild',
        name: 'esbuild',
        version: '0.28.0',
        files: [{ path: 'bin/esbuild' }, { path: 'lib/main.cjs' }, { path: 'package.json' }],
      },
      binding: {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    });
    expect
      .soft(appliedTrace?.materialization?.bin, 'owner FIFO committed recipe bin')
      .toEqual({ esbuild: 'bin/esbuild' });
    expect
      .soft(lockfile.packages['node_modules/esbuild'], 'owner FIFO committed alias lock entry')
      .toMatchObject({
        version: '0.28.0',
        bin: { esbuild: 'bin/esbuild' },
        riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
      });

    const materializedAfterBoth = await Promise.all(
      [
        'node_modules/esbuild/bin/esbuild',
        'node_modules/esbuild/lib/main.cjs',
        'node_modules/esbuild/package.json',
        'node_modules/.bin/esbuild',
      ].map((path) => projectVfs.readFile(`${root}/${path}`)),
    );
    expect(materializedAfterBoth).toEqual(materializedAtPark);
    expect(new TextDecoder().decode(materializedAfterBoth[3])).toBe(
      "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n",
    );
    const applied = lockfile.rifty?.shadowSubstitutions.applied[0];
    if (!applied) throw new Error('esbuild v2 shadow trace missing');
    for (const file of applied.materialization.files) {
      const bytes = await projectVfs.readFile(
        `${root}/${applied.materialization.installPath}/${file.path}`,
      );
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  } finally {
    releaseFirst();
    await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
    await manager.close();
  }
});
