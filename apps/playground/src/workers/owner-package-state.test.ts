import { type InstallOptions, type InstallResult, RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import {
  type FirstMaterializationOwnerPackageConfig,
  type OwnerPackageConfig,
  createOwnerPackageState,
} from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const ROOT = '/project';
const BASE_PACKAGE_JSON = `${JSON.stringify({
  name: 'app',
  version: '1.0.0',
  dependencies: { vite: '5.4.21' },
})}\n`;
const BASE_PACKAGE_LOCK = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
const config: BootstrapConfig = {
  runtime: 'vite',
  root: ROOT,
  port: 5173,
  entryPath: `${ROOT}/src/main.ts`,
  packageName: 'app',
  packageVersion: '1.0.0',
  installDeps: { vite: '5.4.21' },
  packageJson: BASE_PACKAGE_JSON,
  seedFiles: {},
};

function installResult(): InstallResult {
  return {
    packages: [{ name: 'user-pkg', version: '1.0.0', dependencies: {}, files: {} }],
    lockfile: {
      name: 'app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: [{ name: 'user-pkg', version: '1.0.0', transport: 'registry' }],
    },
  };
}

afterEach(() => {
  resetSyncMirror();
  vi.unstubAllGlobals();
});

async function packageMutationHarness(ownerEpoch: string) {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch,
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));
  const firstConfig: FirstMaterializationOwnerPackageConfig = {
    cfg: config,
    templateId: 'vite',
    slug: 'scratch',
    fromScratch: true,
    firstMaterialization: { kind: 'install' },
  };
  let installInvocation = 0;
  const state = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    install: async (arg1) => {
      const opts = arg1 as InstallOptions;
      installInvocation += 1;
      authority.mkdirSync(`${opts.cwd}/node_modules/user-pkg`, { recursive: true });
      authority.writeFileSync(
        `${opts.cwd}/node_modules/user-pkg/index.js`,
        new TextEncoder().encode('module.exports = true;\n'),
      );
      await opts.vfs.writeFile(
        `${opts.cwd}/package-lock.json`,
        `${JSON.stringify({ installInvocation })}\n`,
      );
      return installResult();
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  await expect(state.activateAndEnsure(firstConfig)).resolves.toMatchObject({ kind: 'install' });

  const recordMutation = vi.fn(
    async (_kind: 'dependency' | 'package-manifest' | 'package-lock', _revision: number) => {},
  );
  const shell = new Shell({ cwd: ROOT });
  shell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0, { recordMutation }),
  );

  return { authority, recordMutation, shell, state };
}

it('classifies first dependency arrival separately from user package manifest/lock edits', async () => {
  const { recordMutation, shell } = await packageMutationHarness(
    'owner-package-mutation-classification-test',
  );

  expect((await shell.run('npm install')).exitCode).toBe(0);
  expect(recordMutation).toHaveBeenCalledWith('dependency', expect.any(Number));

  recordMutation.mockClear();
  expect((await shell.run('npm install user-pkg@1.0.0')).exitCode).toBe(0);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual([
    'package-manifest',
    'package-lock',
  ]);
});

it.each(['install', 'i', 'add'] as const)(
  'classifies a first deferred npm %s with a package spec as manifest/lock mutations',
  async (subcommand) => {
    const { recordMutation, shell } = await packageMutationHarness(
      `owner-package-first-user-${subcommand}-classification-test`,
    );

    expect((await shell.run(`npm ${subcommand} user-pkg@1.0.0`)).exitCode).toBe(0);
    expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual([
      'package-manifest',
      'package-lock',
    ]);
  },
);

// Fault class: provenance-lie. A descendant package install cannot attest that
// the configured root's deferred first materialization was consumed.
it('scopes deferred first-materialization consumption to the exact configured root', async () => {
  const { authority, state } = await packageMutationHarness(
    'owner-package-first-materialization-exact-target-test',
  );
  const nestedRoot = `${ROOT}/packages/nested`;
  authority.mkdirSync(nestedRoot, { recursive: true });
  authority.writeFileSync(
    `${nestedRoot}/package.json`,
    new TextEncoder().encode('{"name":"nested","version":"1.0.0"}\n'),
  );

  let phase: 'nested' | 'root' = 'nested';
  const consumptionPhases: Array<'nested' | 'root'> = [];
  const npm = state.createNpmCommand(async () => 0, {
    onFirstMaterializationConsumed: () => consumptionPhases.push(phase),
  });
  const nestedShell = new Shell({ cwd: nestedRoot });
  nestedShell.registerCommand('npm', npm);
  const rootShell = new Shell({ cwd: ROOT });
  rootShell.registerCommand('npm', npm);

  expect.soft((await nestedShell.run('npm install')).exitCode).toBe(0);
  expect.soft(consumptionPhases).toEqual([]);

  phase = 'root';
  expect.soft((await rootShell.run('npm install')).exitCode).toBe(0);
  expect(consumptionPhases).toEqual(['root']);
});

// Fault class: observable-order. Deferred consumption requires the explicit
// owner acknowledgement; install success alone cannot stand in for it.
it('rejects a missing consumption acknowledgement and keeps deferred state retryable', async () => {
  const { state } = await packageMutationHarness(
    'owner-package-first-materialization-missing-acknowledgement-test',
  );
  const missingAcknowledgementShell = new Shell({ cwd: ROOT });
  missingAcknowledgementShell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0),
  );

  const rejected = await missingAcknowledgementShell.run('npm install');
  expect.soft(rejected.exitCode).toBe(1);
  expect.soft(rejected.stderr).toMatch(/deferred first materialization.*owner.*acknowledg/i);

  const consumed = vi.fn();
  const retryShell = new Shell({ cwd: ROOT });
  retryShell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0, {
      onFirstMaterializationConsumed: consumed,
    }),
  );

  expect.soft((await retryShell.run('npm install')).exitCode).toBe(0);
  expect.soft(consumed).toHaveBeenCalledTimes(1);
  expect.soft((await retryShell.run('npm install')).exitCode).toBe(0);
  expect(consumed).toHaveBeenCalledTimes(1);
});

it('preserves a trusted user-extended tree when the first dev config replaces hidden-empty', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-hidden-first-dev-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const extendedPackageJson = `${JSON.stringify({
    name: 'app',
    version: '1.0.0',
    dependencies: { vite: '5.4.21', cowsay: '1.6.0' },
  })}\n`;
  const cowsayBin = `${ROOT}/node_modules/.bin/cowsay`;
  authority.mkdirSync(`${ROOT}/node_modules/.bin`, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(extendedPackageJson));
  authority.writeFileSync(`${ROOT}/package-lock.json`, new TextEncoder().encode(BASE_PACKAGE_LOCK));
  authority.writeFileSync(cowsayBin, new TextEncoder().encode('#!/usr/bin/env node\n'));

  const seedStamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const claim = await seedStamps.demote({ root: ROOT, slug: 'scratch' });
  await expect(
    seedStamps.promote(
      { root: ROOT, slug: 'scratch', packageJsonText: extendedPackageJson },
      { epoch: claim.epoch, packages: 2 },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });

  const state = createOwnerPackageState({
    initial: {
      cfg: {
        ...config,
        packageName: 'rifty-empty',
        installDeps: {},
        packageJson: '{"name":"rifty-empty","private":true}\n',
      },
      templateId: 'hidden-empty',
      slug: 'scratch',
      fromScratch: false,
    },
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.transition({
    cfg: config,
    templateId: 'vite',
    slug: 'scratch',
    fromScratch: false,
  });

  expect(new TextDecoder().decode(authority.readFileBytesSync(cowsayBin))).toBe(
    '#!/usr/bin/env node\n',
  );
  expect(new TextDecoder().decode(authority.readFileBytesSync(`${ROOT}/package.json`))).toBe(
    extendedPackageJson,
  );
  const reloadedStamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  await expect(
    reloadedStamps.check({
      root: ROOT,
      slug: 'scratch',
      expectedPackageJsonText: BASE_PACKAGE_JSON,
    }),
  ).resolves.toMatchObject({ status: 'trusted' });
});

it('starts bounded warm-boot prefetch until async lockfile verification restores trust', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-v4-prefetch-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));
  authority.writeFileSync(`${ROOT}/package-lock.json`, new TextEncoder().encode(BASE_PACKAGE_LOCK));
  const seeded = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const claim = await seeded.demote({ root: ROOT, slug: 'scratch' });
  await expect(
    seeded.promote(
      { root: ROOT, slug: 'scratch', packageJsonText: BASE_PACKAGE_JSON },
      { epoch: claim.epoch, packages: 1 },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });
  const fetchSpy = vi.fn(async () => new Response('bundle'));
  vi.stubGlobal('fetch', fetchSpy);

  createOwnerPackageState({
    initial: { cfg: config, templateId: 'vite', slug: 'scratch', fromScratch: true },
    primeInitialPrefetch: true,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => 'http://eddy.test',
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const restarted = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  await expect(restarted.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
    status: 'trusted',
  });
});

it('reasserts template node_modules inside the package authority without preserving stale trust', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-template-seed-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));
  authority.writeFileSync(`${ROOT}/package-lock.json`, new TextEncoder().encode(BASE_PACKAGE_LOCK));
  const seedPath = `${ROOT}/node_modules/@rifty/example-types/index.d.ts`;
  const seedConfig: BootstrapConfig = {
    ...config,
    seedFiles: { [seedPath]: 'declare const example: true;\n' },
  };
  const ownerConfig = {
    cfg: seedConfig,
    templateId: 'vite',
    slug: 'scratch',
    fromScratch: true,
  };
  const state = createOwnerPackageState({
    initial: ownerConfig,
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await state.reassertTemplateNodeModules(ownerConfig);
  expect(new TextDecoder().decode(authority.readFileBytesSync(seedPath))).toBe(
    'declare const example: true;\n',
  );

  const stamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const claim = await stamps.demote({ root: ROOT, slug: ownerConfig.slug });
  const promotion = await stamps.promote(
    { root: ROOT, slug: ownerConfig.slug, packageJsonText: BASE_PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
  expect(promotion.status).toBe('trusted');

  const noOpRevision = authority.treeRevision;
  await state.reassertTemplateNodeModules(ownerConfig);
  expect(authority.treeRevision).toBe(noOpRevision);
  await expect(stamps.check({ root: ROOT, slug: ownerConfig.slug })).resolves.toMatchObject({
    status: 'trusted',
  });

  authority.rmSync(seedPath, { force: true });
  await state.reassertTemplateNodeModules(ownerConfig);
  expect(authority.existsSync(seedPath)).toBe(true);
  await expect(stamps.check({ root: ROOT, slug: ownerConfig.slug })).resolves.toEqual({
    status: 'absent',
  });
});

it('uses exact session project identity while a full install enters during promotion', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-state-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));

  let releasePromotion!: () => void;
  const promotionGate = new Promise<void>((resolve) => {
    releasePromotion = resolve;
  });
  let calls = 0;
  let secondSawInstalledTree = false;
  let secondSawExactManifest = false;
  let switchedInstallSawPriorTree = false;
  let switchedInstallSawPriorManifest = false;
  const state = createOwnerPackageState({
    initial: { cfg: config, templateId: 'vite', slug: 'scratch', fromScratch: true },
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => promotionGate.then(() => ({ failures: [], total: 0 })),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    install: async (arg1) => {
      const opts = arg1 as InstallOptions;
      calls += 1;
      if (calls === 2) {
        secondSawInstalledTree = authority.existsSync(`${ROOT}/node_modules/user-pkg/keep.js`);
        secondSawExactManifest =
          JSON.parse(new TextDecoder().decode(authority.readFileBytesSync(`${ROOT}/package.json`)))
            .dependencies['user-pkg'] === '1.0.0';
      }
      if (calls === 3) {
        switchedInstallSawPriorTree = authority.existsSync(`${ROOT}/node_modules/user-pkg/keep.js`);
        switchedInstallSawPriorManifest =
          JSON.parse(new TextDecoder().decode(authority.readFileBytesSync(`${ROOT}/package.json`)))
            .dependencies['user-pkg'] === '1.0.0';
      }
      authority.mkdirSync(`${ROOT}/node_modules/user-pkg`, { recursive: true });
      authority.writeFileSync(
        `${ROOT}/node_modules/user-pkg/keep.js`,
        new TextEncoder().encode('installed'),
      );
      await opts.vfs.writeFile(`${ROOT}/package-lock.json`, '{}\n');
      return installResult();
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const shell = new Shell({ cwd: ROOT });
  shell.registerCommand(
    'npm',
    state.createNpmCommand(async () => 0),
  );

  expect((await shell.run('npm install user-pkg@1.0.0')).exitCode).toBe(0);
  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(calls).toBe(2);
  expect(secondSawInstalledTree).toBe(true);
  expect(secondSawExactManifest).toBe(true);

  const switched = {
    cfg: {
      ...config,
      packageName: 'other',
      packageJson: `${JSON.stringify({
        name: 'other',
        version: '1.0.0',
        dependencies: { vite: '5.4.21' },
      })}\n`,
    },
    templateId: 'other',
    slug: 'other',
    fromScratch: true,
  };
  state.configure(switched);
  await state.transition(switched);
  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(calls).toBe(3);
  expect(switchedInstallSawPriorTree).toBe(false);
  expect(switchedInstallSawPriorManifest).toBe(false);
  releasePromotion();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it('activates and ensures independent real project configs without an initial placeholder', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-multi-project-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const projectConfig = (id: 'a' | 'b'): OwnerPackageConfig => {
    const root = `/projects/${id}`;
    const packageJson = `${JSON.stringify({
      name: `workbench-${id}`,
      version: '1.0.0',
      dependencies: { vite: '5.4.21' },
    })}\n`;
    return {
      cfg: {
        ...config,
        root,
        entryPath: `${root}/src/main.ts`,
        packageName: `workbench-${id}`,
        packageJson,
      },
      templateId: `workbench-vite-${id}`,
      slug: `workbench-project-${id}`,
      fromScratch: true,
    };
  };
  const configA = projectConfig('a');
  const configB = projectConfig('b');
  for (const project of [configA, configB]) {
    authority.mkdirSync(project.cfg.root, { recursive: true });
    authority.writeFileSync(
      `${project.cfg.root}/package.json`,
      new TextEncoder().encode(project.cfg.packageJson),
    );
  }
  const installs: string[] = [];
  const state = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: { RIFTY_RUNTIME: 'workbench-test' },
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    install: async (arg1) => {
      const opts = arg1 as InstallOptions;
      installs.push(opts.cwd);
      authority.mkdirSync(`${opts.cwd}/node_modules/vite`, { recursive: true });
      authority.writeFileSync(
        `${opts.cwd}/node_modules/vite/package.json`,
        new TextEncoder().encode('{}\n'),
      );
      await opts.vfs.writeFile(`${opts.cwd}/package-lock.json`, '{}\n');
      return installResult();
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  await expect(state.activateAndEnsure(configA)).resolves.toMatchObject({
    outcome: 'installed',
  });
  await expect(state.activateAndEnsure(configB)).resolves.toMatchObject({
    outcome: 'installed',
  });
  await state.quiesce();
  await expect(state.activateAndEnsure(projectConfig('a'))).resolves.toMatchObject({
    outcome: 'existing',
    identity: installArtifactIdentity,
  });
  await state.quiesce();

  expect(installs).toEqual(['/projects/a', '/projects/b']);
  const stamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  await expect(
    stamps.check({
      root: configA.cfg.root,
      slug: configA.slug,
      expectedPackageJsonText: configA.cfg.packageJson,
    }),
  ).resolves.toMatchObject({ status: 'trusted' });
  await expect(
    stamps.check({
      root: configB.cfg.root,
      slug: configB.slug,
      expectedPackageJsonText: configB.cfg.packageJson,
    }),
  ).resolves.toMatchObject({ status: 'trusted' });
});

it('fault: binds back-to-back activation manifests to their FIFO registration slots', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-activation-registration-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const root = '/projects/shared';
  const projectConfig = (name: 'first' | 'second'): OwnerPackageConfig => ({
    cfg: {
      ...config,
      root,
      entryPath: `${root}/src/main.ts`,
      packageName: name,
      packageJson: `${JSON.stringify({
        name,
        version: '1.0.0',
        dependencies: { vite: '5.4.21' },
      })}\n`,
    },
    templateId: `workbench-${name}`,
    slug: 'shared-project',
    fromScratch: true,
  });
  const firstConfig = projectConfig('first');
  const secondConfig = projectConfig('second');
  authority.mkdirSync(root, { recursive: true });
  authority.writeFileSync(
    `${root}/package.json`,
    new TextEncoder().encode(firstConfig.cfg.packageJson),
  );
  const installedManifests: string[] = [];
  const state = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: '/unused',
      fetch: async () => new Response('', { status: 599 }),
    }),
    install: async (arg1) => {
      const opts = arg1 as InstallOptions;
      installedManifests.push(
        new TextDecoder().decode(authority.readFileBytesSync(`${opts.cwd}/package.json`)),
      );
      authority.mkdirSync(`${opts.cwd}/node_modules/vite`, { recursive: true });
      authority.writeFileSync(
        `${opts.cwd}/node_modules/vite/package.json`,
        new TextEncoder().encode('{}\n'),
      );
      await opts.vfs.writeFile(`${opts.cwd}/package-lock.json`, '{}\n');
      return installResult();
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  const first = state.activateAndEnsure(firstConfig);
  const second = state.activateAndEnsure(secondConfig);
  await Promise.all([first, second]);
  await state.quiesce();

  expect(installedManifests).toEqual([firstConfig.cfg.packageJson, secondConfig.cfg.packageJson]);
});
