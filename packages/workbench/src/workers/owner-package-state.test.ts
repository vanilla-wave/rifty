import { type InstallOptions, type InstallResult, RegistryClient } from '@riftydev/npm-client';
import { type CommandContext, Shell } from '@riftydev/shell';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createNoShadowInstallResultFixture } from './install-result.test-fixture.ts';
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
const config: OwnerPackageConfig['cfg'] = {
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

async function installResult(): Promise<InstallResult> {
  const result: InstallResult = {
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
  return await createNoShadowInstallResultFixture(result);
}

afterEach(resetSyncMirror);

async function packageMutationHarness(
  ownerEpoch: string,
  options: {
    readonly declineFinalize?: boolean;
    readonly failInstallAttempts?: number;
    readonly failFinalizeAttempts?: number;
    readonly afterInstallFlush?: () => Promise<void>;
    readonly mapInvocationContext?: (context: CommandContext) => CommandContext;
  } = {},
) {
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
  let finalizeInvocation = 0;
  const amendGeneratedBaseline = vi.fn(async (_root: string, _lockfile: Uint8Array) => {
    finalizeInvocation += 1;
    if (finalizeInvocation <= (options.failFinalizeAttempts ?? 0)) {
      throw new Error('baseline finalization failed');
    }
    return options.declineFinalize !== true;
  });
  const state = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: async () => {
      if (installInvocation > 0) await options.afterInstallFlush?.();
      return { failures: [], total: 0 };
    },
    amendGeneratedBaseline,
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
        `${JSON.stringify({ lockfileVersion: 3, packages: {}, installInvocation })}\n`,
      );
      if (installInvocation <= (options.failInstallAttempts ?? 0)) {
        throw new Error('install failed');
      }
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
    state.createNpmCommand(async () => 0, {
      recordMutation,
      ...(options.mapInvocationContext === undefined
        ? {}
        : { mapInvocationContext: options.mapInvocationContext }),
    }),
  );

  return { authority, amendGeneratedBaseline, recordMutation, shell, state };
}

it('admits a deferred first-materialization child only while its package tree stays empty', async () => {
  const { authority, state } = await packageMutationHarness(
    'owner-package-empty-tree-admission-test',
  );

  const reservation = await state.reserveChildAdmission(`${ROOT}/src/missing.cjs`);
  expect(reservation.snapshot).toEqual({
    root: ROOT,
    runtimeBindings: [],
  });
  reservation.commit();

  authority.mkdirSync(`${ROOT}/node_modules/partial`, { recursive: true });
  await expect(state.reserveChildAdmission(`${ROOT}/src/missing.cjs`)).rejects.toThrow(
    /readiness is not trusted/,
  );
});

it('rejects deferred empty-tree admission after exact package.json bytes drift', async () => {
  const { authority, state } = await packageMutationHarness(
    'owner-package-empty-manifest-drift-test',
  );
  authority.writeFileSync(
    `${ROOT}/package.json`,
    new TextEncoder().encode(`${BASE_PACKAGE_JSON.trimEnd()} `),
  );

  await expect(state.reserveChildAdmission(`${ROOT}/src/missing.cjs`)).rejects.toThrow(
    /readiness is not trusted/,
  );
});

it('re-publishes an exact empty tree after a coordinated package.json edit', async () => {
  const { authority, state } = await packageMutationHarness(
    'owner-package-empty-manifest-edit-test',
  );
  const editedPackageJson = `${JSON.stringify({
    name: 'app',
    private: true,
    type: 'module',
    scripts: { dev: 'node server.mjs' },
  })}\n`;

  await state.mutations.guardedMutation(
    [{ kind: 'write', path: `${ROOT}/package.json` }],
    async () => {
      authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(editedPackageJson));
    },
  );

  const reservation = await state.reserveChildAdmission(`${ROOT}/server.mjs`);
  expect(reservation.snapshot).toEqual({
    root: ROOT,
    runtimeBindings: [],
  });
  reservation.commit();
});

it('retains the installed tree for runtime after a coordinated package.json edit', async () => {
  const { authority, shell, state } = await packageMutationHarness(
    'owner-package-installed-manifest-edit-test',
  );
  expect((await shell.run('npm install')).exitCode).toBe(0);
  const editedPackageJson = `${JSON.stringify({
    name: 'app',
    private: true,
    type: 'module',
    scripts: { dev: 'node server.mjs' },
  })}\n`;

  await state.mutations.guardedMutation(
    [{ kind: 'write', path: `${ROOT}/package.json` }],
    async () => {
      authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(editedPackageJson));
    },
  );

  const reservation = await state.reserveChildAdmission(`${ROOT}/server.mjs`);
  expect(reservation.snapshot).toEqual({
    root: ROOT,
    runtimeBindings: [],
  });
  reservation.commit();

  await state.mutations.guardedMutation(
    [{ kind: 'rm', path: `${ROOT}/node_modules` }],
    async () => {
      authority.rmSync(`${ROOT}/node_modules`, { recursive: true });
    },
  );
  await expect(state.reserveChildAdmission(`${ROOT}/server.mjs`)).rejects.toThrow(
    /readiness is not published/,
  );
});

it('does not fall through a known nested root after production empty proof fails', async () => {
  const { authority, shell, state } = await packageMutationHarness(
    'owner-package-known-nested-gap-test',
  );
  expect((await shell.run('npm install')).exitCode).toBe(0);
  const nestedRoot = `${ROOT}/packages/nested`;
  const nestedPackageJson = '{"name":"nested","private":true}\n';
  authority.mkdirSync(`${nestedRoot}/node_modules/partial`, { recursive: true });
  authority.writeFileSync(
    `${nestedRoot}/package.json`,
    new TextEncoder().encode(nestedPackageJson),
  );
  const nestedConfig: FirstMaterializationOwnerPackageConfig = {
    cfg: {
      ...config,
      root: nestedRoot,
      entryPath: `${nestedRoot}/src/main.ts`,
      packageName: 'nested',
      installDeps: {},
      packageJson: nestedPackageJson,
    },
    templateId: 'nested-empty',
    slug: 'nested-empty',
    fromScratch: true,
    firstMaterialization: { kind: 'install' },
  };
  await expect(state.activateAndEnsure(nestedConfig)).resolves.toEqual({
    kind: 'install',
    snapshotFailures: [],
  });

  const unknownSubdirectory = await state.reserveChildAdmission(
    `${ROOT}/packages/unknown/src/main.ts`,
  );
  expect(unknownSubdirectory.snapshot.runtimeBindings).toEqual([]);
  unknownSubdirectory.commit();
  await expect(state.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
    `package tree readiness is not published for ${nestedRoot}`,
  );
});

it('classifies first dependency arrival separately from user package manifest/lock edits', async () => {
  const { authority, amendGeneratedBaseline, recordMutation, shell } = await packageMutationHarness(
    'owner-package-mutation-classification-test',
  );

  expect((await shell.run('npm install')).exitCode).toBe(0);
  expect(recordMutation).toHaveBeenCalledWith('dependency', expect.any(Number));
  expect(amendGeneratedBaseline).toHaveBeenCalledWith(
    ROOT,
    authority.readFileBytesSync(`${ROOT}/package-lock.json`),
  );

  recordMutation.mockClear();
  expect((await shell.run('npm install user-pkg@1.0.0')).exitCode).toBe(0);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual([
    'package-manifest',
    'package-lock',
  ]);
  expect(amendGeneratedBaseline).toHaveBeenCalledTimes(1);
});

// Fault class: concurrent-same-key. Baseline-fold provenance belongs to the
// exact terminal invocation, not a shared project key another waiter can clear.
it('keeps first-install baseline classification bound to its terminal invocation', async () => {
  let notePromotionFlush!: () => void;
  const promotionFlushStarted = new Promise<void>((resolve) => {
    notePromotionFlush = resolve;
  });
  let releasePromotionFlush!: () => void;
  const promotionFlushGate = new Promise<void>((resolve) => {
    releasePromotionFlush = resolve;
  });
  let holdFirstFlush = true;
  const { recordMutation, shell } = await packageMutationHarness(
    'owner-package-baseline-result-correlation-test',
    {
      afterInstallFlush: async () => {
        if (!holdFirstFlush) return;
        holdFirstFlush = false;
        notePromotionFlush();
        await promotionFlushGate;
      },
      mapInvocationContext: (context) => ({ ...context }),
    },
  );

  const first = shell.run('npm install');
  await promotionFlushStarted;
  const second = shell.run('npm install');
  releasePromotionFlush();
  expect((await first).exitCode).toBe(0);
  expect((await second).exitCode).toBe(0);

  expect(recordMutation.mock.calls.map(([kind]) => kind).sort()).toEqual([
    'dependency',
    'package-lock',
  ]);
});

it('preserves the seeded package.json version during first dependency arrival', async () => {
  const { authority, shell } = await packageMutationHarness(
    'owner-package-first-install-manifest-version-test',
  );
  const packageJsonPath = `${ROOT}/package.json`;
  const seededVersion = authority.versionOf(packageJsonPath);

  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(authority.versionOf(packageJsonPath)).toBe(seededVersion);
});

it('preserves exact user package.json bytes and version across the first bare install', async () => {
  const { authority, shell, state } = await packageMutationHarness(
    'owner-package-first-install-user-manifest-test',
  );
  const packageJsonPath = `${ROOT}/package.json`;
  const editedPackageJson = new TextEncoder().encode(
    `${JSON.stringify({
      name: 'user-edited-app',
      private: true,
      dependencies: { vite: '6.0.0' },
    })}\n`,
  );
  await state.mutations.guardedMutation([{ kind: 'write', path: packageJsonPath }], async () =>
    authority.writeFileSync(packageJsonPath, editedPackageJson),
  );
  const editedVersion = authority.versionOf(packageJsonPath);

  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(authority.readFileBytesSync(packageJsonPath)).toEqual(editedPackageJson);
  expect(authority.versionOf(packageJsonPath)).toBe(editedVersion);
});

it('replaces a foreign stamped manifest on a cold owner first install', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-cold-foreign-manifest-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  const foreignPackageJson = `${JSON.stringify({
    name: 'foreign-app',
    version: '1.0.0',
    dependencies: { cowsay: '1.6.0' },
  })}\n`;
  authority.mkdirSync(`${ROOT}/node_modules/cowsay`, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(foreignPackageJson));
  authority.writeFileSync(
    `${ROOT}/package-lock.json`,
    new TextEncoder().encode('{"foreign":true}\n'),
  );
  const seedStamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const foreignClaim = await seedStamps.demote({ root: ROOT, slug: 'foreign-project' });
  await expect(
    seedStamps.promote(
      { root: ROOT, slug: 'foreign-project', packageJsonText: foreignPackageJson },
      { epoch: foreignClaim.epoch, packages: 1 },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });

  let installedPackageJson: string | undefined;
  const current = {
    cfg: config,
    templateId: 'vite',
    slug: 'scratch',
    fromScratch: true,
  };
  const state = createOwnerPackageState({
    initial: current,
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
    install: async (arg1) => {
      const opts = arg1 as InstallOptions;
      installedPackageJson = new TextDecoder().decode(
        authority.readFileBytesSync(`${opts.cwd}/package.json`),
      );
      authority.mkdirSync(`${opts.cwd}/node_modules/vite`, { recursive: true });
      authority.writeFileSync(
        `${opts.cwd}/node_modules/vite/package.json`,
        new TextEncoder().encode('{}\n'),
      );
      await opts.vfs.writeFile(
        `${opts.cwd}/package-lock.json`,
        '{"lockfileVersion":3,"packages":{}}\n',
      );
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

  expect((await shell.run('npm install')).exitCode).toBe(0);
  expect(installedPackageJson).toBe(BASE_PACKAGE_JSON);
  expect(new TextDecoder().decode(authority.readFileBytesSync(`${ROOT}/package.json`))).toBe(
    BASE_PACKAGE_JSON,
  );
});

it('withholds generated-baseline ownership when a lockfile predates the first bare install', async () => {
  const { authority, amendGeneratedBaseline, recordMutation, shell, state } =
    await packageMutationHarness('owner-package-first-install-user-lock-test');
  const packageLockPath = `${ROOT}/package-lock.json`;
  await state.mutations.guardedMutation([{ kind: 'write', path: packageLockPath }], async () =>
    authority.writeFileSync(packageLockPath, new TextEncoder().encode('{"user":true}\n')),
  );

  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(amendGeneratedBaseline).not.toHaveBeenCalled();
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
});

it('does not absorb a failed first install lockfile into dependency arrival', async () => {
  const { amendGeneratedBaseline, recordMutation, shell } = await packageMutationHarness(
    'owner-package-failed-first-install-classification-test',
    { failInstallAttempts: 1 },
  );

  expect((await shell.run('npm install')).exitCode).toBe(1);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
  expect(amendGeneratedBaseline).not.toHaveBeenCalled();

  recordMutation.mockClear();
  expect((await shell.run('npm install')).exitCode).toBe(0);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
  expect(amendGeneratedBaseline).not.toHaveBeenCalled();
});

// Fault class: quota/permission rejection at the Git durability boundary must
// fail npm loudly; the generated lock remains visible on the next attempt.
it('leaves the generated lock visible after baseline finalization fails', async () => {
  const { amendGeneratedBaseline, recordMutation, shell } = await packageMutationHarness(
    'owner-package-failed-baseline-finalization-test',
    { failFinalizeAttempts: 1 },
  );

  expect((await shell.run('npm install')).exitCode).toBe(1);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
  expect(amendGeneratedBaseline).toHaveBeenCalledTimes(1);

  recordMutation.mockClear();
  expect((await shell.run('npm install')).exitCode).toBe(0);
  expect(amendGeneratedBaseline).toHaveBeenCalledTimes(1);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
});

it('classifies a declined baseline amend as a visible package-lock mutation', async () => {
  const { amendGeneratedBaseline, recordMutation, shell } = await packageMutationHarness(
    'owner-package-declined-baseline-finalization-test',
    { declineFinalize: true },
  );

  expect((await shell.run('npm install')).exitCode).toBe(0);

  expect(amendGeneratedBaseline).toHaveBeenCalledTimes(1);
  expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual(['package-lock']);
});

it.each(['install', 'i', 'add'] as const)(
  'classifies a first deferred npm %s with a package spec as manifest/lock mutations',
  async (subcommand) => {
    const { amendGeneratedBaseline, recordMutation, shell } = await packageMutationHarness(
      `owner-package-first-user-${subcommand}-classification-test`,
    );

    expect((await shell.run(`npm ${subcommand} user-pkg@1.0.0`)).exitCode).toBe(0);
    expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual([
      'package-manifest',
      'package-lock',
    ]);
    expect(amendGeneratedBaseline).not.toHaveBeenCalled();
  },
);

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

it('reasserts template node_modules inside the package authority; extraneous seed churn keeps trust (ADR-0307)', async () => {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-package-template-seed-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(BASE_PACKAGE_JSON));
  const seedPath = `${ROOT}/node_modules/@rifty/example-types/index.d.ts`;
  const seedConfig: OwnerPackageConfig['cfg'] = {
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
  // ADR-0307: deleting and re-seeding a file INSIDE the tree is extraneous
  // churn — the claim survives, exactly as real npm tolerates tree writes.
  await expect(stamps.check({ root: ROOT, slug: ownerConfig.slug })).resolves.toMatchObject({
    status: 'trusted',
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
  let markPromotionStarted!: () => void;
  const promotionStarted = new Promise<void>((resolve) => {
    markPromotionStarted = resolve;
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
    flush: () => {
      markPromotionStarted();
      return promotionGate.then(() => ({ failures: [], total: 0 }));
    },
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
      await opts.vfs.writeFile(
        `${ROOT}/package-lock.json`,
        '{"lockfileVersion":3,"packages":{}}\n',
      );
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

  const firstInstall = shell.run('npm install user-pkg@1.0.0');
  await promotionStarted;
  const secondInstall = shell.run('npm install');
  await Promise.resolve();
  expect(calls).toBe(1);
  releasePromotion();
  expect((await firstInstall).exitCode).toBe(0);
  expect((await secondInstall).exitCode).toBe(0);

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
      await opts.vfs.writeFile(
        `${opts.cwd}/package-lock.json`,
        '{"lockfileVersion":3,"packages":{}}\n',
      );
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
      await opts.vfs.writeFile(
        `${opts.cwd}/package-lock.json`,
        '{"lockfileVersion":3,"packages":{}}\n',
      );
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
