import { EventEmitter } from 'node:events';
import type { InstallResult } from '@riftydev/npm-client';
import {
  type ShadowSubstitutionPlan,
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from '@riftydev/npm-client/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { type NpmShellCommandDeps, createNpmShellCommand } from '../glue/npm-shell-command.ts';
import {
  type EnsureProjectDepsOptions,
  clearProjectTree,
  ensureProjectDependencies,
} from '../glue/project-deps.ts';
import { createOwnerExecSyncRunner } from './owner-child-node-executor.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type EnsurePackagesCommand,
  type PackageAcquisitionAdapter,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';

const ROOT = '/projects/app';
const PACKAGE_JSON = `${JSON.stringify({
  name: 'app',
  dependencies: { vite: '^5.4.0' },
})}\n`;

const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};
const EMPTY_SHADOW_PLAN = planShadowSubstitutionsFromLockfile({
  lockfileVersion: 3,
  packages: {},
});
const EMPTY_PACKAGE_JSON = '{"name":"app","private":true}\n';

function packageInstall(result: InstallResult, packageJsonText: string | null) {
  return { result, shadowPlan: EMPTY_SHADOW_PLAN, packageJsonText };
}

function esbuildShadowPlan(): ShadowSubstitutionPlan {
  return planAppliedShadowSubstitutions([
    attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
      acquisition: {
        kind: 'registry',
        name: 'esbuild-wasm',
        version: '0.28.0',
        resolved: 'https://registry.test/esbuild-wasm-0.28.0.tgz',
        integrity: `sha512-${btoa(String.fromCharCode(...new Uint8Array(64)))}`,
      },
      installPath: 'node_modules/esbuild',
    }),
  ]);
}

function relocateFirstSubstitution(
  plan: ShadowSubstitutionPlan,
  installPath: string,
): ShadowSubstitutionPlan {
  return planAppliedShadowSubstitutions(
    plan.substitutions.map((substitution, index) =>
      index === 0
        ? {
            ...substitution,
            materialization: { ...substitution.materialization, installPath },
          }
        : substitution,
    ),
  );
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installResult(
  transport: 'cache' | 'eddy' | 'registry',
  options: {
    readonly resolution?: 'lockfile' | 'metadata';
    readonly eddyFallback?: { readonly reason: string };
  } = {},
): InstallResult {
  return {
    packages: [{ name: 'vite', version: '5.4.21', dependencies: {}, files: {} }],
    lockfile: {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: options.resolution ?? 'metadata',
      packages: [{ name: 'vite', version: '5.4.21', transport }],
      ...(options.eddyFallback ? { eddyFallback: options.eddyFallback } : {}),
    },
  };
}

async function seededVfs(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
  return vfs;
}

async function writeInstalledTree(vfs: MemoryVfs, packageJsonText = PACKAGE_JSON): Promise<void> {
  await vfs.writeFile(`${ROOT}/package.json`, packageJsonText);
  await vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
  await vfs.writeFile(`${ROOT}/node_modules/vite/package.json`, '{}\n');
}

function adapterWith(overrides: Partial<PackageAcquisitionAdapter>): PackageAcquisitionAdapter {
  return {
    readTrustedPackageLock: async () => ({ lockfileVersion: 3, packages: {} }),
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'snapshot unavailable' }),
    install: async () => {
      throw new Error('unexpected install');
    },
    reset: async () => {},
    switchProject: async () => {},
    ...overrides,
  };
}

function adapterWithEmptyTreeAttestation(
  overrides: Partial<PackageAcquisitionAdapter>,
  attestEmptyPackageTree: (input: {
    readonly project: PackageAcquisitionProject;
    readonly packageJsonText: string;
  }) => Promise<boolean>,
) {
  return Object.assign(adapterWith(overrides), { attestEmptyPackageTree });
}

function snapshotOnly(command: Omit<EnsurePackagesCommand, 'type'>): EnsurePackagesCommand {
  return {
    type: 'ensure',
    ...command,
    // Contract RED: instant Playground materialization never turns a broken
    // baked snapshot into a hidden network install.
    fallback: 'snapshot-only',
  } as EnsurePackagesCommand;
}

function assertSingleAuthorityInjection(
  npmDeps: Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'>,
  projectDeps: Omit<EnsureProjectDepsOptions, 'packageAcquisitionAuthority'>,
): void {
  // @ts-expect-error Terminal npm composition must inject the owner authority.
  createNpmShellCommand(npmDeps);
  // @ts-expect-error Project dependency composition must inject the same owner authority.
  void ensureProjectDependencies(projectDeps);
}

describe('package-acquisition authority', () => {
  it('keeps both former package entry points dependent on owner injection', () => {
    expect(assertSingleAuthorityInjection).toBeTypeOf('function');
  });

  it('opens a real Owner tree-replacement window after demotion before snapshot restore', async () => {
    const pair = createMemoryFs();
    pair.fsSync.mkdirSync(`${ROOT}/node_modules/old`, { recursive: true });
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
      pair.fsSync,
      { ownerEpoch: 'owner-snapshot-replacement' },
    );
    const stamps = createInstallStampAuthority({
      vfs: pair.vfs,
      fsSync: owner,
      claimIo: installStampClaims,
    });
    const foreign = { ...PROJECT, projectId: 'foreign', slug: 'foreign' };
    const prior = await stamps.demote(foreign);
    await stamps.promote(
      { ...foreign, packageJsonText: PACKAGE_JSON },
      { epoch: prior.epoch, packages: 1 },
    );
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        prepareEnsure: async (command) => {
          clearProjectTree(owner, command.project.root);
          owner.writeFileSync(
            `${command.project.root}/package.json`,
            new TextEncoder().encode(command.packageJsonText),
          );
        },
        planSnapshotRestore: async ({ project }) => ({
          status: 'ready',
          packages: 1,
          shadowPlan: EMPTY_SHADOW_PLAN,
          apply: async () => {
            owner.mkdirSync(`${project.root}/node_modules/vite`, { recursive: true });
            owner.writeFileSync(
              `${project.root}/node_modules/vite/package.json`,
              new TextEncoder().encode('{}\n'),
            );
          },
        }),
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        replaceTreeOnMiss: true,
        snapshot: {
          snapshotId: 'vite-v2',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).resolves.toMatchObject({ outcome: 'snapshot' });
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('opens the same real Owner replacement window before a terminal full install', async () => {
    const pair = createMemoryFs();
    pair.fsSync.mkdirSync(`${ROOT}/node_modules/old`, { recursive: true });
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
      pair.fsSync,
      { ownerEpoch: 'owner-terminal-replacement' },
    );
    const stamps = createInstallStampAuthority({
      vfs: pair.vfs,
      fsSync: owner,
      claimIo: installStampClaims,
    });
    const prior = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: prior.epoch, packages: 1 },
    );
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async (request) => {
          clearProjectTree(owner, request.project.root);
          owner.writeFileSync(
            `${request.project.root}/package.json`,
            new TextEncoder().encode(PACKAGE_JSON),
          );
          owner.mkdirSync(`${request.project.root}/node_modules/vite`, { recursive: true });
          owner.writeFileSync(
            `${request.project.root}/node_modules/vite/package.json`,
            new TextEncoder().encode('{}\n'),
          );
          return packageInstall(installResult('registry'), PACKAGE_JSON);
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toMatchObject({ outcome: 'installed' });
    await authority.quiesce();
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('returns exact existing identity and never reaches snapshot or installer', async () => {
    const vfs = await seededVfs();
    await writeInstalledTree(vfs);
    const stamps = createInstallStampAuthority({ vfs });
    const claim = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: claim.epoch, packages: 1 },
    );
    const calls: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        planSnapshotRestore: async () => {
          calls.push('snapshot');
          return { status: 'rejected', reason: 'unexpected' };
        },
        install: async () => {
          calls.push('install');
          return packageInstall(installResult('registry'), PACKAGE_JSON);
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        snapshot: {
          snapshotId: 'vite-v2',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).resolves.toEqual({ outcome: 'existing', identity: installArtifactIdentity, packages: 1 });
    expect(calls).toEqual([]);
  });

  it('returns exact snapshot id and identity after restore and trusted promotion', async () => {
    const vfs = await seededVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        planSnapshotRestore: async ({ snapshot }) => {
          expect(snapshot.snapshotId).toBe('vite-v2');
          return {
            status: 'ready',
            packages: 1,
            shadowPlan: EMPTY_SHADOW_PLAN,
            apply: () => writeInstalledTree(vfs),
          };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        snapshot: {
          snapshotId: 'vite-v2',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).resolves.toEqual({
      outcome: 'snapshot',
      snapshotId: 'vite-v2',
      identity: installArtifactIdentity,
      packages: 1,
    });
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('maps only InstallResult.provenance into installed provenance', async () => {
    const vfs = await seededVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return {
            result: installResult('registry', {
              resolution: 'lockfile',
              eddyFallback: { reason: 'eddy integrity mismatch' },
            }),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: PACKAGE_JSON,
          };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
      }),
    ).resolves.toEqual({
      outcome: 'installed',
      resolution: 'lockfile',
      packages: [{ name: 'vite', version: '5.4.21', transport: 'registry' }],
      eddyFallback: { reason: 'eddy integrity mismatch' },
    });
  });

  it('snapshot-only rejects metadata mismatch before demote, prepare, restore, or install', async () => {
    const vfs = await seededVfs();
    await writeInstalledTree(vfs);
    const stamps = createInstallStampAuthority({ vfs });
    const foreignProject = { ...PROJECT, projectId: 'foreign', slug: 'foreign' };
    const trusted = await stamps.demote(foreignProject);
    await stamps.promote(
      { ...foreignProject, packageJsonText: PACKAGE_JSON },
      { epoch: trusted.epoch, packages: 1 },
    );
    const calls: string[] = [];
    const adapter = adapterWith({
      planSnapshotRestore: async () => {
        calls.push('restore');
        return {
          status: 'ready',
          packages: 1,
          shadowPlan: EMPTY_SHADOW_PLAN,
          apply: async () => {},
        };
      },
      install: async () => {
        calls.push('install');
        return packageInstall(installResult('registry'), PACKAGE_JSON);
      },
    }) as PackageAcquisitionAdapter & {
      prepareEnsure(command: EnsurePackagesCommand): Promise<void>;
    };
    adapter.prepareEnsure = async () => {
      calls.push('prepare');
      await vfs.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
    };
    const authority = createPackageAcquisitionAuthority({ stamps, adapter });

    await expect(
      authority.dispatch(
        snapshotOnly({
          project: PROJECT,
          packageJsonText: PACKAGE_JSON,
          snapshot: {
            snapshotId: 'stale-vite',
            identity: installArtifactIdentity,
            packageJsonText: '{"name":"different"}\n',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PACKAGE_ACQUISITION_FAILED',
      snapshotFailures: [{ snapshotId: 'stale-vite', reason: 'package-json-mismatch' }],
    });
    expect(calls).toEqual([]);
    await expect(stamps.check({ root: ROOT, slug: foreignProject.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
    await expect(vfs.exists(`${ROOT}/node_modules/vite/package.json`)).resolves.toBe(true);
  });

  it('terminal no-op resolves without fabricating installed provenance', async () => {
    const vfs = await seededVfs();
    const adapter = adapterWith({
      install: async () => ({
        status: 'noop',
        packageJsonText: null,
        shadowPlan: EMPTY_SHADOW_PLAN,
      }),
    });
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter,
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toBeUndefined();
  });

  it('demotes every stamped node_modules ancestor while promoting the actual nested project', async () => {
    const vfs = new MemoryVfs();
    const middleRoot = `${ROOT}/node_modules/middle`;
    const nestedRoot = `${middleRoot}/node_modules/nested`;
    const middlePackageJson = '{"name":"middle","dependencies":{"nested":"1.0.0"}}\n';
    const nestedPackageJson = '{"name":"nested","dependencies":{"vite":"^5.4.0"}}\n';
    const middleProject: PackageAcquisitionProject = {
      projectId: 'middle',
      root: middleRoot,
      slug: 'middle',
      identity: installArtifactIdentity,
    };
    const nestedProject: PackageAcquisitionProject = {
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(`${nestedRoot}/node_modules`, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    await vfs.writeFile(`${middleRoot}/package.json`, middlePackageJson);
    await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
    const stamps = createInstallStampAuthority({ vfs });
    const middleClaim = await stamps.demote(middleProject);
    await stamps.promote(
      { ...middleProject, packageJsonText: middlePackageJson },
      { epoch: middleClaim.epoch, packages: 1 },
    );
    const outerClaim = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: outerClaim.epoch, packages: 2 },
    );
    const calls: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async (request) => {
          calls.push(`install:${request.project.root}`);
          await vfs.mkdir(`${nestedRoot}/node_modules/vite`, { recursive: true });
          await vfs.writeFile(`${nestedRoot}/node_modules/vite/package.json`, '{}\n');
          return packageInstall(installResult('cache'), nestedPackageJson);
        },
      }),
    });

    await authority.dispatch({
      type: 'terminal-install',
      project: nestedProject,
      guardProjects: () => {
        calls.push('guards');
        return [PROJECT, middleProject];
      },
      argv: [],
    });
    await authority.quiesce();

    expect(calls).toEqual(['guards', `install:${nestedRoot}`]);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(
      stamps.check({ root: middleRoot, slug: middleProject.slug }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      stamps.check({ root: nestedRoot, slug: nestedProject.slug }),
    ).resolves.toMatchObject({ status: 'trusted' });
  });

  it('resolves terminal guard projects only when the command reaches the FIFO head', async () => {
    const vfs = await seededVfs();
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    let installs = 0;
    let guardResolutions = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          installs += 1;
          if (installs === 1) {
            firstStarted.resolve();
            await firstGate.promise;
          }
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });

    const first = authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    const second = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      guardProjects: () => {
        guardResolutions += 1;
        return [];
      },
      argv: [],
    });
    await firstStarted.promise;
    expect(guardResolutions).toBe(0);

    firstGate.resolve();
    await Promise.all([first, second]);
    expect(guardResolutions).toBe(1);
  });

  it('keeps unrelated roots behind the existing owner-wide package FIFO', async () => {
    const vfs = await seededVfs();
    const installGate = deferred<void>();
    const installStarted = deferred<void>();
    const timeline: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          timeline.push('install:start');
          installStarted.resolve();
          await installGate.promise;
          await writeInstalledTree(vfs);
          timeline.push('install:end');
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });

    const install = authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    const unrelated = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => {
        timeline.push('discover:unrelated');
        return [];
      },
      mutate: async () => {
        timeline.push('mutate:unrelated');
        await vfs.writeFile(`${ROOT}/src.txt`, 'unrelated');
      },
    });
    await installStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timeline).toEqual(['install:start']);

    installGate.resolve();
    await Promise.all([install, unrelated]);
    expect(timeline).toEqual([
      'install:start',
      'install:end',
      'discover:unrelated',
      'mutate:unrelated',
    ]);
  });

  it('revokes every project below an ancestor removal before applying its bytes', async () => {
    const vfs = new MemoryVfs();
    const otherRoot = '/projects/other';
    const otherProject: PackageAcquisitionProject = {
      projectId: 'other',
      root: otherRoot,
      slug: 'other',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(`${ROOT}/node_modules/pkg`, { recursive: true });
    await vfs.mkdir(`${otherRoot}/node_modules/pkg`, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    await vfs.writeFile(`${otherRoot}/package.json`, PACKAGE_JSON);
    const stamps = createInstallStampAuthority({ vfs });
    for (const project of [PROJECT, otherProject]) {
      const claim = await stamps.demote(project);
      await stamps.promote(
        { ...project, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      );
    }
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({}),
    });

    await authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [
        { mode: 'revoke' as const, root: ROOT },
        { mode: 'revoke' as const, root: otherRoot },
      ],
      mutate: async () => {
        await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
          status: 'absent',
        });
        await expect(
          stamps.check({ root: otherRoot, slug: otherProject.slug }),
        ).resolves.toMatchObject({ status: 'absent' });
        await vfs.rm('/projects', { recursive: true });
      },
    });

    await expect(vfs.exists('/projects')).resolves.toBe(false);
  });

  it('revokes an outer tree and demotes its nested exact-manifest claim in one mutation slot', async () => {
    const vfs = new MemoryVfs();
    const nestedRoot = `${ROOT}/node_modules/nested`;
    const nestedPackageJson = '{"name":"nested","dependencies":{"vite":"^5.4.0"}}\n';
    const nestedProject: PackageAcquisitionProject = {
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(`${nestedRoot}/node_modules/vite`, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
    const stamps = createInstallStampAuthority({ vfs });
    const nestedClaim = await stamps.demote(nestedProject);
    await stamps.promote(
      { ...nestedProject, packageJsonText: nestedPackageJson },
      { epoch: nestedClaim.epoch, packages: 1 },
    );
    const outerClaim = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: outerClaim.epoch, packages: 2 },
    );
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({}),
    });

    await authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [
        { mode: 'revoke' as const, root: ROOT },
        { mode: 'demote' as const, project: nestedProject },
      ],
      mutate: async () => {
        await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
          status: 'absent',
        });
        await expect(
          stamps.check({ root: nestedRoot, slug: nestedProject.slug }),
        ).resolves.toMatchObject({ status: 'pending' });
        await vfs.writeFile(`${nestedRoot}/package.json`, '{"name":"changed"}\n');
      },
    });

    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'absent',
    });
    await expect(
      stamps.check({ root: nestedRoot, slug: nestedProject.slug }),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('fences a parked nested promoter before an outer reset recreates its tree', async () => {
    const vfs = new MemoryVfs();
    const nestedRoot = `${ROOT}/node_modules/nested`;
    const nestedPackageJson = '{"name":"nested","dependencies":{"vite":"^5.4.0"}}\n';
    const nestedProject: PackageAcquisitionProject = {
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(`${nestedRoot}/node_modules/pkg`, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
    await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
    const stamps = createInstallStampAuthority({ vfs });
    const nestedClaim = await stamps.demote(nestedProject);
    let releaseProof!: (report: { failures: []; total: 0 }) => void;
    let proofStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      proofStarted = resolve;
    });
    const promotion = stamps.promote(
      { ...nestedProject, packageJsonText: nestedPackageJson },
      {
        epoch: nestedClaim.epoch,
        packages: 1,
        flush: () => {
          proofStarted();
          return new Promise((resolve) => {
            releaseProof = resolve;
          });
        },
      },
    );
    await started;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      resolveTreeGuards: (root) =>
        root === ROOT ? [{ mode: 'revoke' as const, root: nestedRoot }] : [],
      adapter: adapterWith({
        reset: async () => {
          await vfs.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
          await vfs.mkdir(`${nestedRoot}/node_modules/replacement`, { recursive: true });
          await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
        },
      }),
    });

    await authority.dispatch({ type: 'reset', target: { root: ROOT } });
    releaseProof({ failures: [], total: 0 });

    await expect(promotion).resolves.toMatchObject({ status: 'stale' });
    await expect(
      stamps.check({ root: nestedRoot, slug: nestedProject.slug }),
    ).resolves.toMatchObject({ status: 'absent' });
  });

  it('keeps reset noops inert and supplies the adapter reset only after claim revocation', async () => {
    const vfs = await seededVfs();
    await writeInstalledTree(vfs);
    const stamps = createInstallStampAuthority({ vfs });
    const claim = await stamps.demote(PROJECT);
    await expect(
      stamps.promote(
        { ...PROJECT, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'trusted' });
    const timeline: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        reset: async () => {
          timeline.push('adapter:reset');
        },
      }),
    });

    await authority.dispatch({
      type: 'reset',
      target: { root: ROOT },
      prepare: async () => {
        timeline.push('noop:prepare');
        return { status: 'noop' as const };
      },
    });
    expect(timeline).toEqual(['noop:prepare']);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });

    await authority.dispatch({
      type: 'reset',
      target: { root: ROOT },
      prepare: async () => {
        timeline.push('ready:prepare');
        return {
          status: 'ready',
          resetDependencyTree: true,
          mutate: async (resetDependencyTree) => {
            await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
              status: 'absent',
            });
            timeline.push('ready:scope');
            if (resetDependencyTree === undefined) throw new Error('adapter reset missing');
            await resetDependencyTree();
            timeline.push('ready:mutate');
          },
        };
      },
    });
    expect(timeline).toEqual([
      'noop:prepare',
      'ready:prepare',
      'ready:scope',
      'adapter:reset',
      'ready:mutate',
    ]);
  });

  it('serializes install/install FIFO with no overlapping adapter operation', async () => {
    const vfs = await seededVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    const timeline: string[] = [];
    let active = 0;
    let maximumActive = 0;
    let installNumber = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async (request) => {
          const number = ++installNumber;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          timeline.push(`install-${number}:start:${request.type}`);
          if (number === 1) firstStarted.resolve();
          if (number === 1) await firstGate.promise;
          await writeInstalledTree(vfs);
          timeline.push(`install-${number}:end`);
          active -= 1;
          return {
            result: installResult(number === 1 ? 'eddy' : 'cache'),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: PACKAGE_JSON,
          };
        },
      }),
    });

    const first = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: ['vite@5.4.21'],
    });
    const second = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: ['typescript@5.9.2'],
    });
    await firstStarted.promise;
    expect(timeline).toEqual(['install-1:start:terminal-install']);

    firstGate.resolve();
    await expect(first).resolves.toMatchObject({ outcome: 'installed' });
    await expect(second).resolves.toMatchObject({ outcome: 'installed' });
    expect(timeline).toEqual([
      'install-1:start:terminal-install',
      'install-1:end',
      'install-2:start:terminal-install',
      'install-2:end',
    ]);
    expect(maximumActive).toBe(1);
  });

  it('holds the owner-wide package FIFO across synchronous child spawn', async () => {
    const vfs = await seededVfs();
    const installedRoots: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          installedRoots.push(request.project.root);
          await vfs.mkdir(`${request.project.root}/node_modules/vite`, { recursive: true });
          await vfs.writeFile(`${request.project.root}/node_modules/vite/package.json`, '{}\n');
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    installedRoots.length = 0;
    const reservation = await authority.reserveChildAdmission(ROOT);
    const sameRoot = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: [],
    });
    const otherRoot = '/projects/other';
    await vfs.mkdir(otherRoot, { recursive: true });
    await vfs.writeFile(`${otherRoot}/package.json`, PACKAGE_JSON);
    const unrelated = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'other', root: otherRoot, slug: 'other' },
      argv: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installedRoots).toEqual([]);
    reservation.commit();
    await Promise.all([sameRoot, unrelated]);
    expect(installedRoots).toEqual([ROOT, otherRoot]);
  });

  it('holds every later package mutation behind child admission', async () => {
    const vfs = await seededVfs();
    const nestedRoot = `${ROOT}/node_modules/nested`;
    const monorepoRoot = `${ROOT}/packages/disjoint`;
    for (const root of [nestedRoot, monorepoRoot]) {
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, PACKAGE_JSON);
    }
    const installedRoots: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          installedRoots.push(request.project.root);
          await vfs.mkdir(`${request.project.root}/node_modules/vite`, { recursive: true });
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    installedRoots.length = 0;
    const reservation = await authority.reserveChildAdmission(`${ROOT}/src/main.ts`);
    const monorepo = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'disjoint', root: monorepoRoot, slug: 'disjoint' },
      argv: [],
    });
    const outer = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: [],
    });
    const nested = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'nested', root: nestedRoot, slug: 'nested' },
      guardProjects: () => [PROJECT],
      argv: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installedRoots).toEqual([]);
    reservation.commit();
    await Promise.all([outer, nested, monorepo]);
    expect(installedRoots).toEqual([monorepoRoot, ROOT, nestedRoot]);
  });

  it('serializes sibling nested and unrelated installs through the owner FIFO', async () => {
    const vfs = await seededVfs();
    const firstRoot = `${ROOT}/node_modules/first`;
    const secondRoot = `${ROOT}/node_modules/second`;
    const otherRoot = '/projects/unrelated';
    for (const root of [firstRoot, secondRoot, otherRoot]) {
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, PACKAGE_JSON);
    }
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    const installedRoots: string[] = [];
    const resolvedGuards: string[] = [];
    let activeNested = 0;
    let maximumActiveNested = 0;
    let unrelatedRanDuringNestedInstall = false;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          installedRoots.push(request.project.root);
          const nested = request.project.root === firstRoot || request.project.root === secondRoot;
          if (nested) {
            activeNested += 1;
            maximumActiveNested = Math.max(maximumActiveNested, activeNested);
          } else {
            unrelatedRanDuringNestedInstall = activeNested > 0;
          }
          try {
            if (request.project.root === firstRoot) {
              firstStarted.resolve();
              await firstGate.promise;
            }
            await vfs.mkdir(`${request.project.root}/node_modules/vite`, { recursive: true });
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          } finally {
            if (nested) activeNested -= 1;
          }
        },
      }),
    });

    const first = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'first', root: firstRoot, slug: 'first' },
      guardProjects: () => {
        resolvedGuards.push(firstRoot);
        return [PROJECT];
      },
      argv: [],
    });
    const second = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'second', root: secondRoot, slug: 'second' },
      guardProjects: () => {
        resolvedGuards.push(secondRoot);
        return [PROJECT];
      },
      argv: [],
    });
    await firstStarted.promise;
    const unrelated = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'unrelated', root: otherRoot, slug: 'unrelated' },
      argv: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installedRoots).toEqual([firstRoot]);
    expect(installedRoots).not.toContain(secondRoot);
    expect(resolvedGuards).toEqual([firstRoot]);
    expect(unrelatedRanDuringNestedInstall).toBe(false);

    firstGate.resolve();
    await Promise.all([first, second, unrelated]);
    expect(installedRoots).toEqual([firstRoot, secondRoot, otherRoot]);
    expect(resolvedGuards).toEqual([firstRoot, secondRoot]);
    expect(maximumActiveNested).toBe(1);
  });

  it('keeps sibling monorepo installs in owner admission order', async () => {
    const vfs = await seededVfs();
    const firstRoot = `${ROOT}/packages/first`;
    const secondRoot = `${ROOT}/packages/second`;
    for (const root of [firstRoot, secondRoot]) {
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, PACKAGE_JSON);
    }
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    const installedRoots: string[] = [];
    let activeSiblings = 0;
    let maximumActiveSiblings = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          if (request.project.root === ROOT) {
            await writeInstalledTree(vfs);
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          }
          installedRoots.push(request.project.root);
          activeSiblings += 1;
          maximumActiveSiblings = Math.max(maximumActiveSiblings, activeSiblings);
          try {
            if (request.project.root === firstRoot) {
              firstStarted.resolve();
              await firstGate.promise;
            }
            await vfs.mkdir(`${request.project.root}/node_modules/vite`, { recursive: true });
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          } finally {
            activeSiblings -= 1;
          }
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });

    const first = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'first', root: firstRoot, slug: 'first' },
      argv: [],
    });
    await firstStarted.promise;
    const second = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'second', root: secondRoot, slug: 'second' },
      argv: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installedRoots).toEqual([firstRoot]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(installedRoots).toEqual([firstRoot, secondRoot]);
    expect(maximumActiveSiblings).toBe(1);
  });

  it('serializes caller-owned guarded mutations without a second scheduler', async () => {
    const vfs = await seededVfs();
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    let secondStarted = false;
    let activeMutations = 0;
    let maximumActiveMutations = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({}),
    });
    const runMutation = async (gate?: Promise<void>): Promise<void> => {
      activeMutations += 1;
      maximumActiveMutations = Math.max(maximumActiveMutations, activeMutations);
      try {
        if (gate) {
          firstStarted.resolve();
          await gate;
        } else {
          secondStarted = true;
        }
      } finally {
        activeMutations -= 1;
      }
    };

    const first = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: () => runMutation(firstGate.promise),
    });
    await firstStarted.promise;
    const second = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: () => runMutation(),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted).toBe(false);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
    expect(maximumActiveMutations).toBe(1);
  });

  it('serializes non-tree package operations through the same owner FIFO', async () => {
    const vfs = await seededVfs();
    const firstRoot = `${ROOT}/node_modules/first`;
    const secondRoot = `${ROOT}/node_modules/second`;
    const thirdRoot = `${ROOT}/node_modules/third`;
    for (const root of [firstRoot, secondRoot, thirdRoot]) {
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, PACKAGE_JSON);
    }
    const editGate = deferred<void>();
    const editStarted = deferred<void>();
    let switchStarted = false;
    let deferredMaterializationStarted = false;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        switchProject: async (command) => {
          if (command.to.root === secondRoot) switchStarted = true;
          if (command.to.root === thirdRoot) deferredMaterializationStarted = true;
        },
      }),
    });

    const edit = authority.dispatch({
      type: 'package-json-edit',
      project: { ...PROJECT, projectId: 'first', root: firstRoot, slug: 'first' },
      mutate: async () => {
        editStarted.resolve();
        await editGate.promise;
      },
    });
    await editStarted.promise;
    const projectSwitch = authority.dispatch({
      type: 'project-switch',
      from: null,
      to: { ...PROJECT, projectId: 'second', root: secondRoot, slug: 'second' },
    });
    const deferredMaterialization = authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: { ...PROJECT, projectId: 'third', root: thirdRoot, slug: 'third' },
      packageJsonText: PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switchStarted).toBe(false);
    expect(deferredMaterializationStarted).toBe(false);
    editGate.resolve();
    await Promise.all([edit, projectSwitch, deferredMaterialization]);
    expect(switchStarted).toBe(true);
    expect(deferredMaterializationStarted).toBe(true);
  });

  it('orders entry admission after publication and before every later mutation', async () => {
    const vfs = await seededVfs();
    const outerGate = deferred<void>();
    const outerStarted = deferred<void>();
    const events: string[] = [];
    const siblingRoot = `${ROOT}/node_modules/sibling`;
    await vfs.mkdir(siblingRoot, { recursive: true });
    await vfs.writeFile(`${siblingRoot}/package.json`, PACKAGE_JSON);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          if (request.project.root === siblingRoot) {
            events.push('sibling:mutate');
            await vfs.mkdir(`${siblingRoot}/node_modules/vite`, { recursive: true });
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          }
          if (request.project.root === ROOT) {
            events.push('outer:start');
            outerStarted.resolve();
            await outerGate.promise;
            await writeInstalledTree(vfs);
            events.push('outer:end');
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          }
          throw new Error(`unexpected install root: ${request.project.root}`);
        },
      }),
    });

    const outer = authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    const reservationPromise = authority.reserveChildAdmission(`${ROOT}/src/main.ts`);
    const sibling = authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'sibling', root: siblingRoot, slug: 'sibling' },
      guardProjects: () => [PROJECT],
      argv: [],
    });
    const unrelated = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: async () => {
        events.push('unrelated:mutate');
      },
    });

    await outerStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['outer:start']);
    expect(events).not.toContain('sibling:mutate');

    outerGate.resolve();
    await outer;
    const reservation = await reservationPromise;
    const later = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: async () => {
        events.push('later:mutate');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['outer:start', 'outer:end']);
    expect(events).not.toContain('sibling:mutate');

    reservation.commit();
    await Promise.all([sibling, unrelated, later]);
    expect(events).toEqual([
      'outer:start',
      'outer:end',
      'sibling:mutate',
      'unrelated:mutate',
      'later:mutate',
    ]);
  });

  it('rejects a relative child-admission root loudly', async () => {
    const vfs = await seededVfs();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({}),
    });

    expect(() => authority.reserveChildAdmission('relative')).toThrow(
      /scheduling root must be absolute/,
    );
  });

  it('captures the published tree fact without rereading a later-mutated lockfile', async () => {
    const vfs = await seededVfs();
    const installed = installResult('cache');
    let liveLockfile: unknown = installed.lockfile;
    let trustedReads = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        readTrustedPackageLock: async () => {
          trustedReads += 1;
          return liveLockfile;
        },
        install: async () => {
          await writeInstalledTree(vfs);
          return packageInstall(installed, PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    liveLockfile = {
      lockfileVersion: 3,
      packages: { 'node_modules/forged': { version: '9.9.9' } },
    };

    const reservation = await authority.reserveChildAdmission(ROOT);
    expect(trustedReads).toBe(0);
    expect(reservation.snapshot.plan.substitutions).toEqual([]);
    expect(reservation.snapshot.runtimeBindings).toEqual([]);
    reservation.commit();
  });

  it('composes distinct outer and nested shadow plans with nearest-root path precedence', async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const nestedPackageJson = '{"name":"nested","dependencies":{"vite":"^5.4.0"}}\n';
    const nestedProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
    };
    const outerPlan = esbuildShadowPlan();
    const nestedPlan = relocateFirstSubstitution(
      outerPlan,
      'node_modules/nested-tool/node_modules/esbuild',
    );
    const vfs = await seededVfs();
    await vfs.mkdir(nestedRoot, { recursive: true });
    await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (request) => {
          await vfs.mkdir(`${request.project.root}/node_modules`, { recursive: true });
          const nested = request.project.root === nestedRoot;
          return {
            result: installResult('cache'),
            shadowPlan: nested ? nestedPlan : outerPlan,
            packageJsonText: nested ? nestedPackageJson : PACKAGE_JSON,
          };
        },
      }),
    });

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.quiesce();
    await authority.dispatch({
      type: 'terminal-install',
      project: nestedProject,
      argv: [],
    });
    await authority.quiesce();

    const outer = await authority.reserveChildAdmission(`${ROOT}/src/main.ts`);
    expect(outer.snapshot.root).toBe(ROOT);
    expect(outer.snapshot.plan).toBe(outerPlan);
    expect(outer.snapshot.runtimeBindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        packagePath: `${ROOT}/node_modules/esbuild-wasm`,
      },
    ]);
    expect(Object.isFrozen(outer.snapshot.runtimeBindings)).toBe(true);
    expect(Object.isFrozen(outer.snapshot.runtimeBindings[0])).toBe(true);
    outer.commit();
    const nested = await authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`);
    expect(nested.snapshot.root).toBe(nestedRoot);
    expect(
      nested.snapshot.plan.substitutions.map(
        (substitution) => substitution.materialization.installPath,
      ),
    ).toEqual(['node_modules/esbuild', 'node_modules/nested-tool/node_modules/esbuild']);
    expect(nested.snapshot.runtimeBindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        packagePath: `${nestedRoot}/node_modules/nested-tool/node_modules/esbuild-wasm`,
      },
    ]);
    expect(Object.isFrozen(nested.snapshot.runtimeBindings)).toBe(true);
    expect(Object.isFrozen(nested.snapshot.runtimeBindings[0])).toBe(true);
    nested.commit();
  });

  it('retains an installed ancestor runtime binding through a nearest exact-empty fact', async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const nestedProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
    };
    const outerPlan = esbuildShadowPlan();
    const vfs = await seededVfs();
    await vfs.mkdir(nestedRoot, { recursive: true });
    await vfs.writeFile(`${nestedRoot}/package.json`, EMPTY_PACKAGE_JSON);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          install: async () => {
            await vfs.mkdir(`${ROOT}/node_modules`, { recursive: true });
            return {
              result: installResult('cache'),
              shadowPlan: outerPlan,
              packageJsonText: PACKAGE_JSON,
            };
          },
        },
        async ({ project, packageJsonText }) =>
          (await vfs.readFileText(`${project.root}/package.json`)) === packageJsonText &&
          !(await vfs.exists(`${project.root}/node_modules`)),
      ),
    });

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: PROJECT,
      to: nestedProject,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });
    const reservation = await authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`);

    expect(reservation.snapshot.root).toBe(nestedRoot);
    expect(reservation.snapshot.project).toEqual(nestedProject);
    expect(reservation.snapshot.plan).toBe(outerPlan);
    expect(reservation.snapshot.runtimeBindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        packagePath: `${ROOT}/node_modules/esbuild-wasm`,
      },
    ]);
    reservation.commit();
  });

  it('publishes the installer-owned frozen shadow plan without decoding its lockfile again', async () => {
    const vfs = await seededVfs();
    const installed = installResult('cache');
    Object.defineProperty(installed, 'lockfile', {
      configurable: true,
      get() {
        throw new Error('lockfile decoded twice');
      },
    });
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return {
            result: installed,
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: PACKAGE_JSON,
          };
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toMatchObject({ outcome: 'installed' });
    const reservation = await authority.reserveChildAdmission(ROOT);
    expect(reservation.snapshot.plan).toBe(EMPTY_SHADOW_PLAN);
    reservation.commit();
  });

  it('publishes a trusted empty package tree when the installer proves a no-dependency noop', async () => {
    const packageJsonText = '{"name":"app","private":true}\n';
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, packageJsonText);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await vfs.mkdir(`${ROOT}/node_modules`, { recursive: true });
          return {
            status: 'noop',
            packageJsonText,
            shadowPlan: EMPTY_SHADOW_PLAN,
          };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText,
      }),
    ).resolves.toEqual({
      outcome: 'installed',
      resolution: 'metadata',
      packages: [],
    });
    const reservation = await authority.reserveChildAdmission(ROOT);
    expect(reservation.snapshot.plan).toBe(EMPTY_SHADOW_PLAN);
    expect(reservation.snapshot.plan.bindings).toEqual([]);
    expect(reservation.snapshot.runtimeBindings).toEqual([]);
    reservation.commit();
  });

  it('publishes and reattests an explicit empty tree for deferred first materialization', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => true);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: null,
        to: PROJECT,
        packageJsonText: EMPTY_PACKAGE_JSON,
        materialization: { kind: 'install' },
      }),
    ).resolves.toEqual({ kind: 'install', snapshotFailures: [] });
    const reservation = await authority.reserveChildAdmission(`${ROOT}/src/missing.cjs`);

    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
    expect(reservation.snapshot).toMatchObject({
      root: ROOT,
      project: PROJECT,
      plan: EMPTY_SHADOW_PLAN,
      runtimeBindings: [],
    });
    reservation.commit();
  });

  it('publishes the exact empty tree when snapshot resolution defers to install', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => true);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: null,
        to: PROJECT,
        packageJsonText: EMPTY_PACKAGE_JSON,
        materialization: {
          kind: 'snapshot',
          source: {
            snapshotId: 'unavailable-snapshot',
            resolve: async () => ({
              status: 'rejected' as const,
              reason: 'snapshot-fetch-unavailable',
            }),
          },
        },
      }),
    ).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [
        { snapshotId: 'unavailable-snapshot', reason: 'snapshot-fetch-unavailable' },
      ],
    });
    const reservation = await authority.reserveChildAdmission(`${ROOT}/src/missing.cjs`);

    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
    expect(reservation.snapshot).toMatchObject({
      root: ROOT,
      project: PROJECT,
      plan: EMPTY_SHADOW_PLAN,
      runtimeBindings: [],
    });
    reservation.commit();
  });

  it('publishes the exact empty tree when a resolved snapshot plan is rejected', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => true);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          planSnapshotRestore: async () => ({
            status: 'rejected',
            reason: 'snapshot archive is unsafe',
          }),
        },
        attestEmptyPackageTree,
      ),
    });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: null,
        to: PROJECT,
        packageJsonText: EMPTY_PACKAGE_JSON,
        materialization: {
          kind: 'snapshot',
          source: {
            snapshotId: 'rejected-snapshot',
            resolve: async () => ({
              status: 'candidate' as const,
              snapshot: {
                snapshotId: 'rejected-snapshot',
                identity: PROJECT.identity,
                packageJsonText: EMPTY_PACKAGE_JSON,
              },
            }),
          },
        },
      }),
    ).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [{ snapshotId: 'rejected-snapshot', reason: 'snapshot archive is unsafe' }],
    });
    const reservation = await authority.reserveChildAdmission(`${ROOT}/src/missing.cjs`);

    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
    expect(reservation.snapshot.root).toBe(ROOT);
    reservation.commit();
  });

  it('keeps snapshot failure details but leaves deferred install unpublished on false proof', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => false);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: null,
        to: PROJECT,
        packageJsonText: EMPTY_PACKAGE_JSON,
        materialization: {
          kind: 'snapshot',
          source: {
            snapshotId: 'torn-snapshot',
            resolve: async () => ({ status: 'rejected' as const, reason: 'snapshot torn' }),
          },
        },
      }),
    ).resolves.toEqual({
      kind: 'install',
      snapshotFailures: [{ snapshotId: 'torn-snapshot', reason: 'snapshot torn' }],
    });

    expect(attestEmptyPackageTree).toHaveBeenCalledOnce();
    await expect(authority.reserveChildAdmission(`${ROOT}/src/missing.cjs`)).rejects.toThrow(
      /readiness is not published/,
    );
  });

  it('invalidates stale installed readiness before a deferred manifest proof fails', async () => {
    const vfs = await seededVfs();
    const attestEmptyPackageTree = vi.fn(async () => false);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          install: async () => {
            await writeInstalledTree(vfs);
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          },
        },
        attestEmptyPackageTree,
      ),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });

    await expect(
      authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: true }),
        from: PROJECT,
        to: PROJECT,
        packageJsonText: EMPTY_PACKAGE_JSON,
        materialization: { kind: 'install' },
      }),
    ).resolves.toEqual({ kind: 'install', snapshotFailures: [] });

    expect(attestEmptyPackageTree).toHaveBeenCalledOnce();
    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      /readiness is not published/,
    );
  });

  it('invalidates a published fact owned by the previous same-root project', async () => {
    const nextProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'next-app',
      slug: 'next-app',
    };
    const vfs = await seededVfs();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.dispatch({
      type: 'project-switch',
      from: PROJECT,
      to: nextProject,
    });

    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not trusted for ${ROOT}`,
    );
    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not published for ${ROOT}`,
    );
  });

  it('requires a fact for a known nested project while an unknown subdirectory uses outer Node ancestry', async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const nestedProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
    };
    const vfs = await seededVfs();
    await vfs.mkdir(nestedRoot, { recursive: true });
    await vfs.writeFile(`${nestedRoot}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => false);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          install: async () => {
            await writeInstalledTree(vfs);
            return packageInstall(installResult('cache'), PACKAGE_JSON);
          },
        },
        attestEmptyPackageTree,
      ),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: PROJECT,
      to: nestedProject,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    const unknownSubdirectory = await authority.reserveChildAdmission(
      `${ROOT}/packages/unknown/src/main.ts`,
    );
    expect(unknownSubdirectory.snapshot.root).toBe(ROOT);
    unknownSubdirectory.commit();
    await expect(authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not published for ${nestedRoot}`,
    );
  });

  it('does not publish empty readiness when the FIFO-head proof sees package-tree bytes', async () => {
    const vfs = await seededVfs();
    const attestEmptyPackageTree = vi.fn(async () => false);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });

    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(1);
    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      /readiness is not published/,
    );
  });

  it('rechecks an empty-tree fact at child admission and deletes it on drift', async () => {
    const vfs = await seededVfs();
    const attestEmptyPackageTree = vi
      .fn<
        (input: { project: PackageAcquisitionProject; packageJsonText: string }) => Promise<boolean>
      >()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      /readiness is not trusted/,
    );
    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      /readiness is not published/,
    );
    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
  });

  it('re-publishes an exact empty fact only after a failed install rolls the tree back', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const timeline: string[] = [];
    const attestEmptyPackageTree = vi.fn(async ({ packageJsonText }) => {
      const trusted =
        (await vfs.readFileText(`${ROOT}/package.json`)) === packageJsonText &&
        !(await vfs.exists(`${ROOT}/node_modules`));
      timeline.push(`attest:${String(trusted)}`);
      return trusted;
    });
    const installFailure = new Error('unsupported esbuild range');
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          install: async () => {
            await vfs.writeFile(`${ROOT}/package.json`, '{"name":"mutating"}\n');
            await vfs.mkdir(`${ROOT}/node_modules/partial`, { recursive: true });
            timeline.push('install:mutated');
            await vfs.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
            await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
            timeline.push('install:rolled-back');
            throw installFailure;
          },
        },
        attestEmptyPackageTree,
      ),
    });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });
    timeline.length = 0;

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).rejects.toMatchObject({
      failure: 'install',
      cause: installFailure,
    });
    expect(timeline).toEqual(['install:mutated', 'install:rolled-back', 'attest:true']);

    const reservation = await authority.reserveChildAdmission(`${ROOT}/src/missing.cjs`);
    expect(timeline).toEqual([
      'install:mutated',
      'install:rolled-back',
      'attest:true',
      'attest:true',
    ]);
    expect(reservation.snapshot.root).toBe(ROOT);
    reservation.commit();
  });

  it('never turns a failed replacement of an empty fact into child readiness', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => !(await vfs.exists(`${ROOT}/node_modules`)));
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {
          install: async () => {
            await vfs.mkdir(`${ROOT}/node_modules/partial`, { recursive: true });
            throw new Error('replacement failed after partial tree write');
          },
        },
        attestEmptyPackageTree,
      ),
    });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).rejects.toThrow('package install failed');
    await expect(authority.reserveChildAdmission(`${ROOT}/src/main.ts`)).rejects.toThrow(
      /readiness is not published/,
    );
    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
  });

  it('waits for an overlapping physical mutation before reattesting an empty fact', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir(ROOT, { recursive: true });
    await vfs.writeFile(`${ROOT}/package.json`, EMPTY_PACKAGE_JSON);
    const mutationStarted = deferred<void>();
    const mutationGate = deferred<void>();
    const attestEmptyPackageTree = vi.fn(async () => !(await vfs.exists(`${ROOT}/node_modules`)));
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    const mutation = authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [],
      mutate: async () => {
        await vfs.mkdir(`${ROOT}/node_modules/partial`, { recursive: true });
        mutationStarted.resolve();
        await mutationGate.promise;
      },
    });
    await mutationStarted.promise;
    let childSettled = false;
    const child = authority.reserveChildAdmission(`${ROOT}/src/main.ts`).finally(() => {
      childSettled = true;
    });

    await Promise.resolve();
    expect(childSettled).toBe(false);
    expect(attestEmptyPackageTree).toHaveBeenCalledOnce();

    mutationGate.resolve();
    await mutation;
    await expect(child).rejects.toThrow(/readiness is not trusted/);
    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(2);
  });

  it('keeps nested empty facts distinct and validates their ancestry for child admission', async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const nestedProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
    };
    const vfs = await seededVfs();
    await vfs.mkdir(nestedRoot, { recursive: true });
    await vfs.writeFile(`${nestedRoot}/package.json`, EMPTY_PACKAGE_JSON);
    const attestEmptyPackageTree = vi.fn(async () => true);
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation({}, attestEmptyPackageTree),
    });

    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: null,
      to: PROJECT,
      packageJsonText: PACKAGE_JSON,
      materialization: { kind: 'install' },
    });
    await authority.dispatch({
      type: 'prepare-first-materialization',
      register: () => ({ manifestChanged: false }),
      from: PROJECT,
      to: nestedProject,
      packageJsonText: EMPTY_PACKAGE_JSON,
      materialization: { kind: 'install' },
    });

    const nested = await authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`);
    expect(nested.snapshot.root).toBe(nestedRoot);
    nested.commit();
    const outer = await authority.reserveChildAdmission(`${ROOT}/src/main.ts`);
    expect(outer.snapshot.root).toBe(ROOT);
    outer.commit();
    await expect(authority.reserveChildAdmission('/projects/unrelated/main.ts')).rejects.toThrow(
      /readiness is not published/,
    );
    expect(attestEmptyPackageTree).toHaveBeenCalledTimes(5);
  });

  it.each([
    { name: 'nearest', invalid: (nestedRoot: string) => nestedRoot },
    { name: 'ancestor', invalid: () => ROOT },
  ])(
    'does not fall through after an invalid $name fact in the published ancestry',
    async ({ invalid }) => {
      const nestedRoot = `${ROOT}/packages/nested`;
      const nestedProject: PackageAcquisitionProject = {
        ...PROJECT,
        projectId: 'nested',
        root: nestedRoot,
        slug: 'nested',
      };
      const vfs = await seededVfs();
      await vfs.mkdir(nestedRoot, { recursive: true });
      await vfs.writeFile(`${nestedRoot}/package.json`, EMPTY_PACKAGE_JSON);
      let invalidRoot: string | null = null;
      const authority = createPackageAcquisitionAuthority({
        stamps: createInstallStampAuthority({ vfs }),
        adapter: adapterWithEmptyTreeAttestation(
          {},
          async ({ project }) => project.root !== invalidRoot,
        ),
      });
      for (const [from, to, packageJsonText] of [
        [null, PROJECT, PACKAGE_JSON],
        [PROJECT, nestedProject, EMPTY_PACKAGE_JSON],
      ] as const) {
        await authority.dispatch({
          type: 'prepare-first-materialization',
          register: () => ({ manifestChanged: false }),
          from,
          to,
          packageJsonText,
          materialization: { kind: 'install' },
        });
      }
      invalidRoot = invalid(nestedRoot);

      await expect(authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
        `package tree readiness is not trusted for ${invalidRoot}`,
      );
      await expect(authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
        /readiness is not published/,
      );
    },
  );

  it('keeps valid outer and sibling facts after a nearest empty fact drifts', async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const siblingRoot = `${ROOT}/packages/sibling`;
    const projects = [
      PROJECT,
      { ...PROJECT, projectId: 'nested', root: nestedRoot, slug: 'nested' },
      { ...PROJECT, projectId: 'sibling', root: siblingRoot, slug: 'sibling' },
    ];
    const vfs = await seededVfs();
    for (const project of projects.slice(1)) {
      await vfs.mkdir(project.root, { recursive: true });
      await vfs.writeFile(`${project.root}/package.json`, EMPTY_PACKAGE_JSON);
    }
    let invalidRoot: string | null = null;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {},
        async ({ project }) => project.root !== invalidRoot,
      ),
    });
    for (const [index, project] of projects.entries()) {
      await authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: index === 0 ? null : (projects[index - 1] ?? null),
        to: project,
        packageJsonText: project === PROJECT ? PACKAGE_JSON : EMPTY_PACKAGE_JSON,
        materialization: { kind: 'install' },
      });
    }
    invalidRoot = nestedRoot;

    await expect(authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not trusted for ${nestedRoot}`,
    );
    await expect(authority.reserveChildAdmission(`${nestedRoot}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not published for ${nestedRoot}`,
    );
    const outer = await authority.reserveChildAdmission(`${ROOT}/src/main.ts`);
    expect(outer.snapshot.root).toBe(ROOT);
    outer.commit();
    const sibling = await authority.reserveChildAdmission(`${siblingRoot}/src/main.ts`);
    expect(sibling.snapshot.root).toBe(siblingRoot);
    sibling.commit();
  });

  it('blocks sibling admission below a torn ancestor without touching a disjoint root', async () => {
    const nestedRoots = [`${ROOT}/packages/a`, `${ROOT}/packages/b`] as const;
    const unrelatedRoot = '/projects/unrelated';
    const projects = [
      PROJECT,
      ...nestedRoots.map(
        (root, index): PackageAcquisitionProject => ({
          ...PROJECT,
          projectId: `nested-${String(index)}`,
          root,
          slug: `nested-${String(index)}`,
        }),
      ),
      { ...PROJECT, projectId: 'unrelated', root: unrelatedRoot, slug: 'unrelated' },
    ];
    const vfs = await seededVfs();
    for (const project of projects.slice(1)) {
      await vfs.mkdir(project.root, { recursive: true });
      await vfs.writeFile(`${project.root}/package.json`, EMPTY_PACKAGE_JSON);
    }
    let invalidRoot: string | null = null;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWithEmptyTreeAttestation(
        {},
        async ({ project }) => project.root !== invalidRoot,
      ),
    });
    for (const [index, project] of projects.entries()) {
      await authority.dispatch({
        type: 'prepare-first-materialization',
        register: () => ({ manifestChanged: false }),
        from: index === 0 ? null : (projects[index - 1] ?? null),
        to: project,
        packageJsonText: project === PROJECT ? PACKAGE_JSON : EMPTY_PACKAGE_JSON,
        materialization: { kind: 'install' },
      });
    }
    invalidRoot = ROOT;

    await expect(authority.reserveChildAdmission(`${nestedRoots[0]}/src/main.ts`)).rejects.toThrow(
      `package tree readiness is not trusted for ${ROOT}`,
    );
    await expect(authority.reserveChildAdmission(`${nestedRoots[1]}/src/main.ts`)).rejects.toThrow(
      /readiness is not published/,
    );
    const unrelated = await authority.reserveChildAdmission(`${unrelatedRoot}/src/main.ts`);
    expect(unrelated.snapshot.root).toBe(unrelatedRoot);
    unrelated.commit();
  });

  it('invalidates published readiness before a mutation or failed replacement can expose it', async () => {
    const vfs = await seededVfs();
    let failInstall = false;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          if (failInstall) throw new Error('replacement failed');
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.dispatch({
      type: 'guarded-mutation',
      resolveTransitions: () => [{ mode: 'revoke' as const, root: ROOT }],
      mutate: async () => {},
    });
    await expect(authority.reserveChildAdmission(ROOT)).rejects.toThrow(
      /readiness is not published/,
    );

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    failInstall = true;
    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).rejects.toThrow('package install failed');
    await expect(authority.reserveChildAdmission(ROOT)).rejects.toThrow(
      /readiness is not published/,
    );
  });

  it('rejects a published fact after the trusted manifest claim drifts', async () => {
    const vfs = await seededVfs();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.quiesce();
    await vfs.writeFile(`${ROOT}/package.json`, '{"name":"drifted"}\n');

    await expect(authority.reserveChildAdmission(ROOT)).rejects.toThrow(/readiness is not trusted/);
  });

  it('releases a failed post-spawn reservation only after confirmed child settlement', async () => {
    const vfs = await seededVfs();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    const reservation = await authority.reserveChildAdmission(ROOT);
    const exited = deferred<void>();
    const aborting = reservation.abortAfterChildSettlement(
      new Error('spawn supervision failed'),
      exited.promise,
    );
    let installSettled = false;
    const queued = authority
      .dispatch({ type: 'terminal-install', project: PROJECT, argv: [] })
      .then(() => {
        installSettled = true;
      });

    await Promise.resolve();
    expect(installSettled).toBe(false);
    exited.resolve();
    await aborting;
    await queued;
    expect(installSettled).toBe(true);
  });

  it('keeps the real owner child failure seam reserved until physical exit', async () => {
    const vfs = await seededVfs();
    let installStarts = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          installStarts += 1;
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    installStarts = 0;
    const setupFailure = new Error('child stdout binding failed after spawn');
    const child = Object.assign(new EventEmitter(), {
      stdout: {
        on() {
          throw setupFailure;
        },
      },
      stderr: { on: vi.fn() },
      terminate: vi.fn(),
    });
    const spawn = vi.fn(() => child);
    const run = createOwnerExecSyncRunner(
      'https://example.invalid/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://example.invalid/kernel.js' },
      () => ROOT,
      (root) => authority.reserveChildAdmission(root),
      spawn,
    );
    const running = run(
      {
        entryPath: '/src/child.mjs',
        argv: ['rifty', '/src/child.mjs'],
        env: {},
        cwd: '/',
      },
      { parentPid: 42 },
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(child.terminate).toHaveBeenCalledOnce();
    let queuedSettled = false;
    const queued = authority
      .dispatch({ type: 'terminal-install', project: PROJECT, argv: [] })
      .then(() => {
        queuedSettled = true;
      });

    await Promise.resolve();
    expect(installStarts).toBe(0);
    expect(queuedSettled).toBe(false);
    child.emit('exit', null, 'SIGTERM');
    await expect(running).rejects.toBe(setupFailure);
    await queued;
    expect(installStarts).toBe(1);
    expect(queuedSettled).toBe(true);
  });

  it('keeps a failed post-spawn reservation when exit observation rejects without proving death', async () => {
    const vfs = await seededVfs();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });
    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.quiesce();
    const reservation = await authority.reserveChildAdmission(ROOT);
    const observationFailure = new Error('exit observer failed before physical death');
    await expect(
      reservation.abortAfterChildSettlement(
        new Error('spawn supervision failed'),
        Promise.reject(observationFailure),
      ),
    ).rejects.toBe(observationFailure);
    let installSettled = false;
    void authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }).then(() => {
      installSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installSettled).toBe(false);
  });

  it('fault: keeps promotion and readiness publication inside the owner FIFO', async () => {
    const secondRoot = '/projects/later';
    const secondPackageJson = '{"name":"later","dependencies":{"vite":"^5.4.0"}}\n';
    const secondProject: PackageAcquisitionProject = {
      projectId: 'later',
      root: secondRoot,
      slug: 'later',
      identity: installArtifactIdentity,
    };
    const vfs = await seededVfs();
    await vfs.mkdir(secondRoot, { recursive: true });
    await vfs.writeFile(`${secondRoot}/package.json`, secondPackageJson);
    const firstInstallStarted = deferred<void>();
    const firstInstallGate = deferred<void>();
    const firstPromotionStarted = deferred<void>();
    const firstPromotionGate = deferred<void>();
    const secondInstallStarted = deferred<void>();
    const secondInstallGate = deferred<void>();
    let installNumber = 0;
    let flushNumber = 0;
    const stamps = createInstallStampAuthority({ vfs });
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: () => {
          flushNumber += 1;
          if (flushNumber !== 1) return Promise.resolve(undefined);
          firstPromotionStarted.resolve();
          return firstPromotionGate.promise.then(() => undefined);
        },
      },
      adapter: adapterWith({
        install: async (request) => {
          installNumber += 1;
          if (installNumber === 1) {
            firstInstallStarted.resolve();
            await firstInstallGate.promise;
          } else {
            secondInstallStarted.resolve();
            await secondInstallGate.promise;
          }
          await vfs.mkdir(`${request.project.root}/node_modules/vite`, { recursive: true });
          await vfs.writeFile(`${request.project.root}/node_modules/vite/package.json`, '{}\n');
          return {
            result: installResult('registry'),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: request.project.root === ROOT ? PACKAGE_JSON : secondPackageJson,
          };
        },
      }),
    });

    let firstSettled = false;
    const first = authority
      .dispatch({
        type: 'terminal-install',
        project: PROJECT,
        argv: [],
      })
      .then((result) => {
        firstSettled = true;
        return result;
      });
    await firstInstallStarted.promise;
    let quiesced = false;
    const quiescence = authority.quiesce().then(() => {
      quiesced = true;
    });
    let secondSettled = false;
    const second = authority
      .dispatch({ type: 'terminal-install', project: secondProject, argv: [] })
      .then((result) => {
        secondSettled = true;
        return result;
      });

    firstInstallGate.resolve();
    await firstPromotionStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(firstSettled).toBe(true);
    expect(quiesced).toBe(false);
    expect(secondSettled).toBe(false);
    expect(installNumber).toBe(1);

    firstPromotionGate.resolve();
    await expect(first).resolves.toMatchObject({ outcome: 'installed' });
    await quiescence;
    expect(quiesced).toBe(true);
    expect(secondSettled).toBe(false);
    await secondInstallStarted.promise;
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });

    secondInstallGate.resolve();
    await expect(second).resolves.toMatchObject({ outcome: 'installed' });
    await authority.quiesce();
  });

  it('captures a warm trusted same-project tree before terminal demotion', async () => {
    const vfs = await seededVfs();
    await writeInstalledTree(vfs);
    await vfs.writeFile(`${ROOT}/package-lock.json`, '{"lockfileVersion":3}\n');
    const stamps = createInstallStampAuthority({ vfs });
    const claim = await stamps.demote(PROJECT);
    await stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      { epoch: claim.epoch, packages: 1 },
    );
    let seen: { readonly priorTrustedTree: boolean; readonly priorSlug?: string } | undefined;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async (_request, execution) => {
          seen = execution;
          return {
            result: installResult('cache', { resolution: 'lockfile' }),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: PACKAGE_JSON,
          };
        },
      }),
    });

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });

    expect(seen).toMatchObject({ priorTrustedTree: true, priorSlug: PROJECT.slug });
    await expect(vfs.readFileText(`${ROOT}/node_modules/vite/package.json`)).resolves.toBe('{}\n');
    await expect(vfs.readFileText(`${ROOT}/package-lock.json`)).resolves.toBe(
      '{"lockfileVersion":3}\n',
    );
  });

  it('shares terminal session activity across normalized root aliases', async () => {
    const vfs = await seededVfs();
    const seen: Array<{
      readonly activity: boolean;
      readonly priorSessionSlug?: string;
    }> = [];
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async (_request, execution) => {
          seen.push({
            activity: execution.sessionInstallActivity,
            ...(execution.priorSessionSlug !== undefined
              ? { priorSessionSlug: execution.priorSessionSlug }
              : {}),
          });
          await writeInstalledTree(vfs);
          return packageInstall(installResult('cache'), PACKAGE_JSON);
        },
      }),
    });

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    await authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, root: `${ROOT}/.` },
      argv: [],
    });
    await authority.dispatch({
      type: 'terminal-install',
      project: { ...PROJECT, projectId: 'next', slug: 'next' },
      argv: [],
    });

    expect(seen).toEqual([
      { activity: false },
      { activity: true, priorSessionSlug: PROJECT.slug },
      { activity: true, priorSessionSlug: PROJECT.slug },
    ]);
  });

  it('serializes install -> manifest edit -> reset -> project switch in dispatch order', async () => {
    const vfs = await seededVfs();
    const stamps = createInstallStampAuthority({ vfs });
    const installGate = deferred<void>();
    const installStarted = deferred<void>();
    const timeline: string[] = [];
    const nextProject: PackageAcquisitionProject = {
      ...PROJECT,
      projectId: 'next',
      root: '/projects/next',
      slug: 'next',
    };
    const editedPackageJson = `${JSON.stringify({
      name: 'app',
      dependencies: { vite: '^5.4.0', nanoid: '^5.1.5' },
    })}\n`;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      adapter: adapterWith({
        install: async () => {
          timeline.push('install:start');
          installStarted.resolve();
          await installGate.promise;
          await writeInstalledTree(vfs);
          timeline.push('install:end');
          return packageInstall(installResult('registry'), PACKAGE_JSON);
        },
        reset: async () => {
          timeline.push('reset');
        },
        switchProject: async ({ from, to }) => {
          timeline.push(`switch:${from?.projectId}->${to.projectId}`);
        },
      }),
    });

    const install = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: [],
    });
    const manifest = authority.dispatch({
      type: 'package-json-edit',
      project: PROJECT,
      mutate: async () => {
        timeline.push('manifest');
        await vfs.writeFile(`${ROOT}/package.json`, editedPackageJson);
      },
    });
    const reset = authority.dispatch({ type: 'reset', target: { root: PROJECT.root } });
    const projectSwitch = authority.dispatch({
      type: 'project-switch',
      from: PROJECT,
      to: nextProject,
    });
    await installStarted.promise;
    expect(timeline).toEqual(['install:start']);

    installGate.resolve();
    await Promise.all([install, manifest, reset, projectSwitch]);
    expect(timeline).toEqual([
      'install:start',
      'install:end',
      'manifest',
      'reset',
      'switch:app->next',
    ]);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.not.toMatchObject({
      status: 'trusted',
    });
  });
});
