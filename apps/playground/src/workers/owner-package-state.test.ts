import { type InstallOptions, type InstallResult, RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const ROOT = '/project';
const BASE_PACKAGE_JSON = `${JSON.stringify({
  name: 'app',
  version: '1.0.0',
  dependencies: { vite: '5.4.21' },
})}\n`;
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

afterEach(resetSyncMirror);

it('reasserts template node_modules inside the package authority without preserving stale trust', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-template-seed-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));
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
