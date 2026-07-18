import type { InstallResult } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { clearProjectTree } from '../glue/project-deps.ts';
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
const enc = new TextEncoder();

const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function resultLockfile(): InstallResult['lockfile'] {
  return {
    name: 'app',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {},
  };
}

function resultLockfileText(): string {
  return `${JSON.stringify(resultLockfile(), null, 2)}\n`;
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
    lockfile: resultLockfile(),
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
  await vfs.writeFile(`${ROOT}/package-lock.json`, resultLockfileText());
  await vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
  await vfs.writeFile(`${ROOT}/node_modules/vite/package.json`, '{}\n');
}

function adapterWith(overrides: Partial<PackageAcquisitionAdapter>): PackageAcquisitionAdapter {
  return {
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'snapshot unavailable' }),
    install: async () => {
      throw new Error('unexpected install');
    },
    reset: async () => {},
    switchProject: async () => {},
    ...overrides,
  };
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

describe('package-acquisition authority', () => {
  it('opens a real Owner tree-replacement window after demotion before snapshot restore', async () => {
    const pair = createMemoryFs();
    pair.fsSync.mkdirSync(`${ROOT}/node_modules/old`, { recursive: true });
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
    pair.fsSync.writeFileSync(`${ROOT}/package-lock.json`, enc.encode(resultLockfileText()));
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
          apply: async () => {
            owner.writeFileSync(
              `${project.root}/package-lock.json`,
              enc.encode(resultLockfileText()),
            );
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
    pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
    pair.fsSync.writeFileSync(`${ROOT}/package-lock.json`, enc.encode(resultLockfileText()));
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
          owner.writeFileSync(`${request.project.root}/package.json`, enc.encode(PACKAGE_JSON));
          owner.writeFileSync(
            `${request.project.root}/package-lock.json`,
            enc.encode(resultLockfileText()),
          );
          owner.mkdirSync(`${request.project.root}/node_modules/vite`, { recursive: true });
          owner.writeFileSync(
            `${request.project.root}/node_modules/vite/package.json`,
            new TextEncoder().encode('{}\n'),
          );
          return { result: installResult('registry'), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
    ).resolves.toMatchObject({ outcome: 'installed' });
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
          return { result: installResult('registry'), packageJsonText: PACKAGE_JSON };
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
        return { status: 'ready', packages: 1, apply: async () => {} };
      },
      install: async () => {
        calls.push('install');
        return { result: installResult('registry'), packageJsonText: PACKAGE_JSON };
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
      install: async () => ({ status: 'noop' }) as never,
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
    await vfs.writeFile(`${ROOT}/package-lock.json`, resultLockfileText());
    await vfs.writeFile(`${middleRoot}/package-lock.json`, resultLockfileText());
    await vfs.writeFile(`${nestedRoot}/package-lock.json`, resultLockfileText());
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
          await vfs.writeFile(`${nestedRoot}/package-lock.json`, resultLockfileText());
          return { result: installResult('cache'), packageJsonText: nestedPackageJson };
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
          return { result: installResult('cache'), packageJsonText: PACKAGE_JSON };
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

  it('holds an unrelated guarded writer behind an in-flight install before discovering targets', async () => {
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
          return { result: installResult('cache'), packageJsonText: PACKAGE_JSON };
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
    await vfs.writeFile(`${ROOT}/package-lock.json`, resultLockfileText());
    await vfs.writeFile(`${otherRoot}/package-lock.json`, resultLockfileText());
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
    await vfs.writeFile(`${ROOT}/package-lock.json`, resultLockfileText());
    await vfs.writeFile(`${nestedRoot}/package-lock.json`, resultLockfileText());
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
    await vfs.writeFile(`${nestedRoot}/package-lock.json`, resultLockfileText());
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

  it('fault: quiesces prior FIFO work through detached stamp settlement without waiting for later admission', async () => {
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
          await vfs.writeFile(`${request.project.root}/package-lock.json`, resultLockfileText());
          return {
            result: installResult('registry'),
            packageJsonText: request.project.root === ROOT ? PACKAGE_JSON : secondPackageJson,
          };
        },
      }),
    });

    const first = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: [],
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
    await expect(first).resolves.toMatchObject({ outcome: 'installed' });
    await firstPromotionStarted.promise;
    await secondInstallStarted.promise;
    expect(quiesced).toBe(false);

    firstPromotionGate.resolve();
    await quiescence;
    expect(quiesced).toBe(true);
    expect(secondSettled).toBe(false);
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
          return { result: installResult('cache'), packageJsonText: PACKAGE_JSON };
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
          return { result: installResult('registry'), packageJsonText: PACKAGE_JSON };
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
