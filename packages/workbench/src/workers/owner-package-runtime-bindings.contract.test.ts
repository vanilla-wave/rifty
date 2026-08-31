import { readFile } from 'node:fs/promises';
import {
  type InstallOptions,
  type Packument,
  RegistryClient,
  type VersionManifest,
  install,
} from '@riftydev/npm-client';
import {
  type ShadowSubstitutionPlan,
  shadowSubstitutionPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createPackageAcquisitionAuthority } from './package-acquisition-authority.ts';

const ROOT = '/projects/sass-bindingless';
const fixtureRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);

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

interface LightningRegistryFixture {
  readonly name: string;
  readonly version: string;
  readonly dist: { readonly integrity: string };
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundleDependencies: readonly string[];
}

interface RegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

const sass = JSON.parse(
  await readFile(new URL('sass-1.100.0-registry.json', fixtureRoot), 'utf8'),
) as SassRegistryFixture;
const closure = JSON.parse(
  await readFile(new URL('sass-1.100.0-closure.json', fixtureRoot), 'utf8'),
) as SassClosureFixture;
const lightning = JSON.parse(
  await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', fixtureRoot), 'utf8'),
) as LightningRegistryFixture;
const lightningTarball = new Uint8Array(
  await readFile(new URL('lightningcss-wasm-1.32.0.tgz', fixtureRoot)),
);

const entries = new Map<string, RegistryEntry>(
  await Promise.all(
    [
      {
        name: sass.name,
        version: sass.version,
        manifest: {
          name: sass.name,
          version: sass.version,
          dependencies: { ...sass.dependencies },
          optionalDependencies: { ...sass.optionalDependencies },
          peerDependencies: { ...sass.peerDependencies },
          bin: { ...sass.bin },
          dist: {
            integrity: sass.dist.integrity,
            tarball: `fixture:${encodeURIComponent(sass.name)}`,
          },
        } satisfies VersionManifest,
      },
      ...closure.packages.map((item) => ({
        name: item.name,
        version: item.version,
        manifest: {
          name: item.name,
          version: item.version,
          dependencies: { ...item.dependencies },
          dist: {
            integrity: item.integrity,
            tarball: `fixture:${encodeURIComponent(item.name)}`,
          },
        } satisfies VersionManifest,
      })),
    ].map(
      async ({ name, version, manifest }) =>
        [
          name,
          {
            manifest,
            tarball: new Uint8Array(await readFile(new URL(`${name}-${version}.tgz`, fixtureRoot))),
          },
        ] as const,
    ),
  ),
);

class SassRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/sass-fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    const entry = entries.get(name);
    if (!entry) throw new Error(`unexpected Sass fixture packument ${name}`);
    return {
      name,
      'dist-tags': { latest: entry.manifest.version },
      versions: { [entry.manifest.version]: entry.manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const entry = entries.get(decodeURIComponent(url.slice('fixture:'.length)));
    if (!entry) throw new Error(`unexpected Sass fixture tarball ${url}`);
    return entry.tarball.slice();
  }
}

class LightningRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/lightning-fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    if (name !== lightning.name) throw new Error(`unexpected Lightning fixture packument ${name}`);
    const manifest = {
      name: lightning.name,
      version: lightning.version,
      dependencies: { ...lightning.dependencies },
      optionalDependencies: { ...lightning.optionalDependencies },
      peerDependencies: { ...lightning.peerDependencies },
      bundleDependencies: [...lightning.bundleDependencies],
      dist: {
        integrity: lightning.dist.integrity,
        tarball: `fixture:${encodeURIComponent(lightning.name)}`,
      },
    } satisfies VersionManifest & { readonly bundleDependencies: readonly string[] };
    return {
      name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    if (url !== `fixture:${encodeURIComponent(lightning.name)}`) {
      throw new Error(`unexpected Lightning fixture tarball ${url}`);
    }
    return lightningTarball.slice();
  }
}

function config(): OwnerPackageConfig {
  const packageJson = `${JSON.stringify({
    name: 'sass-bindingless',
    version: '1.0.0',
    dependencies: { 'sass-embedded': '1.100.0' },
  })}\n`;
  return {
    cfg: {
      runtime: 'node-cli',
      root: ROOT,
      entryPath: `${ROOT}/main.mjs`,
      packageName: 'sass-bindingless',
      packageVersion: '1.0.0',
      installDeps: { 'sass-embedded': '1.100.0' },
      packageJson,
      seedFiles: {},
    },
    templateId: 'sass-bindingless-contract',
    slug: 'sass-bindingless',
    fromScratch: true,
  };
}

function lightningConfig(): OwnerPackageConfig {
  const packageJson = `${JSON.stringify({
    name: 'lightning-bindingless',
    version: '1.0.0',
    dependencies: { lightningcss: '1.32.0' },
  })}\n`;
  return {
    cfg: {
      runtime: 'node-cli',
      root: '/projects/lightning-bindingless',
      entryPath: '/projects/lightning-bindingless/main.mjs',
      packageName: 'lightning-bindingless',
      packageVersion: '1.0.0',
      installDeps: { lightningcss: '1.32.0' },
      packageJson,
      seedFiles: {},
    },
    templateId: 'lightning-bindingless-contract',
    slug: 'lightning-bindingless',
    fromScratch: true,
  };
}

afterEach(resetSyncMirror);

it('carries the real bindingless Sass plan through owner publication and child admission', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-sass-bindingless-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const packageConfig = config();
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(
    `${ROOT}/package.json`,
    new TextEncoder().encode(packageConfig.cfg.packageJson),
  );
  let observedPlan: ShadowSubstitutionPlan | undefined;
  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new SassRegistry(),
    install: async (input) => {
      if (typeof input === 'string') throw new Error('owner install must use InstallOptions');
      const result = await install(input as InstallOptions);
      observedPlan = shadowSubstitutionPlanForInstallResult(result);
      return result;
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.activateAndEnsure(packageConfig);
  expect(observedPlan).toMatchObject({
    bindings: [],
    substitutions: [
      {
        substitutionId: 'rifty.shadow-substitution.sass-embedded.v2',
        acquisition: { kind: 'registry', name: 'sass', version: '1.100.0' },
      },
    ],
  });
  expect(Object.isFrozen(observedPlan)).toBe(true);
  expect(Object.isFrozen(observedPlan?.substitutions)).toBe(true);

  const reservation = await state.reserveChildAdmission(`${ROOT}/main.mjs`);
  expect(reservation.snapshot.runtimeBindings).toEqual([]);
  expect(Object.isFrozen(reservation.snapshot.runtimeBindings)).toBe(true);
  reservation.commit();
});

it('retains the installer-owned nonempty Sass plan in the owner package reservation', async () => {
  const vfs = new MemoryVfs();
  const packageJsonText = config().cfg.packageJson;
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, packageJsonText);
  let installedPlan: ShadowSubstitutionPlan | undefined;
  const owner = createPackageAcquisitionAuthority({
    stamps: createInstallStampAuthority({ vfs }),
    adapter: {
      planSnapshotRestore: async () => ({ status: 'rejected', reason: 'not a snapshot run' }),
      install: async (request) => {
        const result = await install({
          vfs,
          cwd: request.project.root,
          registry: new SassRegistry(),
        });
        installedPlan = shadowSubstitutionPlanForInstallResult(result);
        return { result, shadowPlan: installedPlan, packageJsonText };
      },
      reset: async () => {},
      switchProject: async () => {},
    },
  });

  await owner.dispatch({
    type: 'terminal-install',
    project: {
      projectId: 'sass-bindingless',
      root: ROOT,
      slug: 'sass-bindingless',
      identity: installArtifactIdentity,
    },
    argv: [],
  });
  const reservation = await owner.reserveChildAdmission(`${ROOT}/main.mjs`);

  expect(installedPlan).toBeDefined();
  expect(reservation.snapshot.plan).toBe(installedPlan);
  expect(reservation.snapshot.plan).toMatchObject({
    bindings: [],
    substitutions: [
      {
        substitutionId: 'rifty.shadow-substitution.sass-embedded.v2',
        acquisition: { kind: 'registry', name: 'sass', version: '1.100.0' },
      },
    ],
  });
  expect(reservation.snapshot.runtimeBindings).toEqual([]);
  reservation.commit();
});

it('carries the real bindingless LightningCSS plan through owner child admission', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-lightning-bindingless-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const packageConfig = lightningConfig();
  authority.mkdirSync(packageConfig.cfg.root, { recursive: true });
  authority.writeFileSync(
    `${packageConfig.cfg.root}/package.json`,
    new TextEncoder().encode(packageConfig.cfg.packageJson),
  );
  let observedPlan: ShadowSubstitutionPlan | undefined;
  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new LightningRegistry(),
    install: async (input) => {
      if (typeof input === 'string') throw new Error('owner install must use InstallOptions');
      const result = await install(input as InstallOptions);
      observedPlan = shadowSubstitutionPlanForInstallResult(result);
      return result;
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.activateAndEnsure(packageConfig);
  expect(observedPlan).toMatchObject({
    bindings: [],
    substitutions: [
      {
        substitutionId: 'rifty.shadow-substitution.lightningcss.v2',
        acquisition: { kind: 'registry', name: 'lightningcss-wasm', version: '1.32.0' },
      },
    ],
  });
  const reservation = await state.reserveChildAdmission(packageConfig.cfg.entryPath);
  expect(reservation.snapshot.runtimeBindings).toEqual([]);
  reservation.commit();
});
