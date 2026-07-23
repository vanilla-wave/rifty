import type { InstallResult } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from '../glue/install-stamp-authority.ts';
import { installStampPath } from '../glue/install-stamp.ts';
import {
  type AcquisitionObservation,
  type PackageAcquisitionAdapter,
  PackageAcquisitionError,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';

const ROOT = '/projects/app';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"^5.4.0"}}\n';
const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};

async function vfsHarness(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
  return vfs;
}

async function seedTree(vfs: MemoryVfs): Promise<void> {
  await vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
  await vfs.writeFile(`${ROOT}/node_modules/vite/package.json`, '{}\n');
}

async function trustTree(vfs: MemoryVfs, stamps: InstallStampAuthority): Promise<void> {
  await seedTree(vfs);
  const claim = await stamps.demote(PROJECT);
  await stamps.promote(
    { ...PROJECT, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
}

function result(): InstallResult {
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
      resolution: 'metadata',
      packages: [{ name: 'vite', version: '5.4.21', transport: 'registry' }],
      eddyFallback: { reason: 'eddy bundle corrupt' },
    },
  };
}

function adapterWith(overrides: Partial<PackageAcquisitionAdapter>): PackageAcquisitionAdapter {
  return {
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unavailable' }),
    install: async () => {
      throw new Error('unexpected install');
    },
    reset: async () => {},
    switchProject: async () => {},
    ...overrides,
  };
}

describe('package-acquisition authority faults', () => {
  it('forwards durability proof to demote before an existing tree can be mutated', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const durabilityFailure = new Error('OPFS flush failed');
    let installCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          throw durabilityFailure;
        },
      },
      adapter: adapterWith({
        install: async () => {
          installCalls += 1;
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    let caught: unknown;
    try {
      await authority.dispatch({
        type: 'terminal-install',
        project: PROJECT,
        argv: ['vite'],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PackageAcquisitionError);
    expect((caught as PackageAcquisitionError).cause).toMatchObject({
      code: 'INSTALL_STAMP_DEMOTE_UNPROVEN',
      cause: durabilityFailure,
    });
    expect(installCalls).toBe(0);
  });

  it('fences nested install bytes when an outer guard cannot be demoted durably', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const nestedRoot = `${ROOT}/node_modules/nested`;
    const nestedProject: PackageAcquisitionProject = {
      projectId: 'nested',
      root: nestedRoot,
      slug: 'nested',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(nestedRoot, { recursive: true });
    await vfs.writeFile(`${nestedRoot}/package.json`, '{"name":"nested"}\n');
    const durabilityFailure = new Error('outer guard flush failed');
    let installCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          throw durabilityFailure;
        },
      },
      adapter: adapterWith({
        install: async () => {
          installCalls += 1;
          return { result: result(), packageJsonText: '{"name":"nested"}\n' };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'terminal-install',
        project: nestedProject,
        guardProjects: () => [PROJECT],
        argv: [],
      }),
    ).rejects.toMatchObject({
      code: 'PACKAGE_ACQUISITION_FAILED',
      failure: 'claim',
      cause: { cause: durabilityFailure },
    });
    expect(installCalls).toBe(0);
    await expect(vfs.exists(`${nestedRoot}/node_modules`)).resolves.toBe(false);
  });

  it('applies no bytes when the second target in a guarded mutation cannot be revoked', async () => {
    const vfs = await vfsHarness();
    const otherRoot = '/projects/other';
    const otherProject: PackageAcquisitionProject = {
      projectId: 'other',
      root: otherRoot,
      slug: 'other',
      identity: installArtifactIdentity,
    };
    await vfs.mkdir(`${otherRoot}/node_modules/pkg`, { recursive: true });
    await vfs.writeFile(`${otherRoot}/package.json`, PACKAGE_JSON);
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const otherClaim = await stamps.demote(otherProject);
    await stamps.promote(
      { ...otherProject, packageJsonText: PACKAGE_JSON },
      { epoch: otherClaim.epoch, packages: 1 },
    );
    let flushCalls = 0;
    let mutationCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          flushCalls += 1;
          return flushCalls === 2
            ? {
                failures: [
                  {
                    path: installStampPath(otherRoot),
                    op: 'rm' as const,
                    message: 'QuotaExceededError',
                  },
                ],
                total: 1,
              }
            : { failures: [], total: 0 };
        },
      },
      adapter: adapterWith({}),
    });

    await expect(
      authority.dispatch({
        type: 'guarded-mutation',
        resolveTransitions: () => [
          { mode: 'revoke' as const, root: ROOT },
          { mode: 'revoke' as const, root: otherRoot },
        ],
        mutate: async () => {
          mutationCalls += 1;
          await vfs.writeFile('/projects/mutated', 'must-not-land');
        },
      }),
    ).rejects.toMatchObject({ code: 'INSTALL_STAMP_REVOKE_UNPROVEN' });
    expect(flushCalls).toBe(2);
    expect(mutationCalls).toBe(0);
    await expect(vfs.exists('/projects/mutated')).resolves.toBe(false);
  });

  it('keeps successful install provenance prompt-fast when background promotion is refused', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const observations: AcquisitionObservation[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps,
      observe: (event) => observations.push(event),
      stampTransition: {
        flush: async () => {
          await flushGate;
          return {
            failures: [
              {
                path: `${ROOT}/node_modules/vite/package.json`,
                op: 'write',
                message: 'QuotaExceededError',
              },
            ],
            total: 1,
          };
        },
      },
      adapter: adapterWith({
        install: async () => {
          await seedTree(vfs);
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    const install = authority.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: ['vite'],
    });
    const promptOutcome = await Promise.race([
      install,
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 20)),
    ]);
    expect(promptOutcome).toMatchObject({
      outcome: 'installed',
      packages: [{ name: 'vite', version: '5.4.21', transport: 'registry' }],
    });
    releaseFlush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.not.toMatchObject({
      status: 'trusted',
    });
    expect(observations).toContainEqual(
      expect.objectContaining({ type: 'promotion-refused', projectId: PROJECT.projectId }),
    );
  });

  it('forwards durability proof to reset revocation before reset mutates the tree', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    let resetCalls = 0;
    const durabilityFailure = new Error('OPFS flush failed');
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          throw durabilityFailure;
        },
      },
      adapter: adapterWith({
        reset: async () => {
          resetCalls += 1;
        },
      }),
    });

    await expect(
      authority.dispatch({ type: 'reset', target: { root: PROJECT.root } }),
    ).rejects.toMatchObject({
      code: 'INSTALL_STAMP_REVOKE_UNPROVEN',
      cause: durabilityFailure,
    });
    expect(resetCalls).toBe(0);
  });

  it('runs reset mutation inside the FIFO and fences an older background promoter', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    let releasePromotion!: () => void;
    const promotionGate = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    let flushCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          flushCalls += 1;
          if (flushCalls === 1) await promotionGate;
          return { failures: [], total: 0 };
        },
      },
      adapter: adapterWith({
        install: async () => {
          await seedTree(vfs);
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: ['vite'] });
    const reset = authority.dispatch({
      type: 'reset',
      target: { root: PROJECT.root },
      prepare: async () => ({
        status: 'ready' as const,
        mutate: async () => {
          await vfs.rm(ROOT, { recursive: true, force: true });
          await vfs.mkdir(ROOT, { recursive: true });
          await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
          await vfs.writeFile(`${ROOT}/reset-marker`, 'reset');
        },
      }),
    });
    releasePromotion();
    await reset;

    await expect(vfs.readFileText(`${ROOT}/reset-marker`)).resolves.toBe('reset');
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.not.toMatchObject({
      status: 'trusted',
    });
  });

  it('keeps a partially failed reset untrusted and preserves the exact mutation cause', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const partialFailure = new Error('starter seed failed after package.json');

    await expect(
      createPackageAcquisitionAuthority({ stamps, adapter: adapterWith({}) }).dispatch({
        type: 'reset',
        target: { root: PROJECT.root },
        prepare: async () => ({
          status: 'ready' as const,
          mutate: async () => {
            await vfs.rm(ROOT, { recursive: true, force: true });
            await vfs.mkdir(ROOT, { recursive: true });
            await vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
            throw partialFailure;
          },
        }),
      }),
    ).rejects.toBe(partialFailure);

    await expect(vfs.readFileText(`${ROOT}/package.json`)).resolves.toBe(PACKAGE_JSON);
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.not.toMatchObject({
      status: 'trusted',
    });
  });

  it('durably demotes before a package.json edit and never writes after an unproven demotion', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const durabilityFailure = new Error('package.json demotion flush failed');
    let mutationCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: { flush: async () => Promise.reject(durabilityFailure) },
      adapter: adapterWith({}),
    });

    await expect(
      authority.dispatch({
        type: 'package-json-edit',
        project: PROJECT,
        mutate: async () => {
          mutationCalls += 1;
          await vfs.writeFile(`${ROOT}/package.json`, '{"name":"edited"}\n');
        },
      }),
    ).rejects.toMatchObject({
      code: 'INSTALL_STAMP_DEMOTE_UNPROVEN',
      cause: durabilityFailure,
    });
    expect(mutationCalls).toBe(0);
    await expect(vfs.readFileText(`${ROOT}/package.json`)).resolves.toBe(PACKAGE_JSON);
  });

  it('does not fabricate node_modules or a stamp for an absent-tree package.json edit', async () => {
    const vfs = await vfsHarness();
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({}),
    });

    await authority.dispatch({
      type: 'package-json-edit',
      project: PROJECT,
      mutate: async () => {
        await vfs.writeFile(`${ROOT}/package.json`, '{"name":"edited"}\n');
      },
    });

    expect(await vfs.exists(`${ROOT}/node_modules`)).toBe(false);
    expect(await vfs.exists(`${ROOT}/node_modules/.rifty-install-stamp.json`)).toBe(false);
  });

  it.each([
    ['terminal noop', async () => ({ status: 'noop' as const })],
    [
      'installer failure',
      async () => {
        throw new Error('registry unavailable');
      },
    ],
  ])(
    'does not fabricate node_modules or a stamp after %s on an absent tree',
    async (_label, install) => {
      const vfs = await vfsHarness();
      const authority = createPackageAcquisitionAuthority({
        stamps: createInstallStampAuthority({ vfs }),
        adapter: adapterWith({ install }),
      });

      await authority
        .dispatch({ type: 'terminal-install', project: PROJECT, argv: [] })
        .catch(() => undefined);

      expect(await vfs.exists(`${ROOT}/node_modules`)).toBe(false);
      expect(await vfs.exists(`${ROOT}/node_modules/.rifty-install-stamp.json`)).toBe(false);
    },
  );

  it('does not mutate a clean project switch when durable destination revocation fails', async () => {
    const vfs = await vfsHarness();
    const stamps = createInstallStampAuthority({ vfs });
    await trustTree(vfs, stamps);
    const durabilityFailure = new Error('OPFS revoke failed');
    let switchCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps,
      stampTransition: {
        flush: async () => {
          throw durabilityFailure;
        },
      },
      adapter: adapterWith({
        switchProject: async () => {
          switchCalls += 1;
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'project-switch',
        from: PROJECT,
        to: { ...PROJECT, projectId: 'next', slug: 'next' },
        resetPackages: true,
        packageJsonText: PACKAGE_JSON,
      }),
    ).rejects.toMatchObject({
      code: 'INSTALL_STAMP_REVOKE_UNPROVEN',
      cause: durabilityFailure,
    });
    expect(switchCalls).toBe(0);
  });

  it.each([
    [
      'package-json',
      {
        snapshotId: 'stale-vite',
        identity: installArtifactIdentity,
        packageJsonText: '{"name":"different"}\n',
      },
      'package-json-mismatch',
    ],
    [
      'install-artifact identity',
      {
        snapshotId: 'stale-vite',
        identity: `sha256:${'0'.repeat(64)}`,
        packageJsonText: PACKAGE_JSON,
      },
      'install-artifact-identity-mismatch',
    ],
  ] as const)(
    'records exact %s snapshot mismatch and falls through without restoring',
    async (_axis, snapshot, expectedReason) => {
      const vfs = await vfsHarness();
      const observations: AcquisitionObservation[] = [];
      let restoreCalls = 0;
      const authority = createPackageAcquisitionAuthority({
        stamps: createInstallStampAuthority({ vfs }),
        observe: (event) => observations.push(event),
        adapter: adapterWith({
          planSnapshotRestore: async () => {
            restoreCalls += 1;
            return { status: 'ready', packages: 1, apply: async () => {} };
          },
          install: async () => {
            await seedTree(vfs);
            return { result: result(), packageJsonText: PACKAGE_JSON };
          },
        }),
      });

      await expect(
        authority.dispatch({
          type: 'ensure',
          project: PROJECT,
          packageJsonText: PACKAGE_JSON,
          snapshot,
        }),
      ).resolves.toMatchObject({ outcome: 'installed' });
      expect(restoreCalls).toBe(0);
      expect(observations).toEqual([
        {
          type: 'snapshot-rejected',
          projectId: 'app',
          snapshotId: 'stale-vite',
          reason: expectedReason,
        },
      ]);
    },
  );

  it('re-prepares after a partial snapshot restore fails before falling through to install', async () => {
    const vfs = await vfsHarness();
    const partial = `${ROOT}/node_modules/partial-snapshot.txt`;
    let prepareCalls = 0;
    let partialSeenByInstall = true;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        prepareEnsure: async () => {
          prepareCalls += 1;
          await vfs.rm(partial, { force: true });
        },
        planSnapshotRestore: async () => ({
          status: 'ready',
          packages: 1,
          apply: async () => {
            await vfs.mkdir(`${ROOT}/node_modules`, { recursive: true });
            await vfs.writeFile(partial, 'partial');
            throw new Error('quota');
          },
        }),
        install: async () => {
          partialSeenByInstall = await vfs.exists(partial);
          await seedTree(vfs);
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await authority.dispatch({
      type: 'ensure',
      project: PROJECT,
      packageJsonText: PACKAGE_JSON,
      snapshot: {
        snapshotId: 'vite-v2',
        identity: installArtifactIdentity,
        packageJsonText: PACKAGE_JSON,
      },
    });

    expect(prepareCalls).toBe(2);
    expect(partialSeenByInstall).toBe(false);
  });

  it('cleans a partial snapshot-only restore before reporting snapshot unavailability', async () => {
    const vfs = await vfsHarness();
    const partial = `${ROOT}/node_modules/partial-snapshot.txt`;
    const phases: string[] = [];
    let installCalls = 0;
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        prepareEnsure: async (_command, execution) => {
          phases.push(execution.phase);
          await vfs.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
        },
        planSnapshotRestore: async () => ({
          status: 'ready',
          packages: 1,
          apply: async () => {
            await vfs.mkdir(`${ROOT}/node_modules`, { recursive: true });
            await vfs.writeFile(partial, 'partial');
            throw new Error('quota');
          },
        }),
        install: async () => {
          installCalls += 1;
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        fallback: 'snapshot-only',
        snapshot: {
          snapshotId: 'vite-v2',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).rejects.toMatchObject({
      failure: 'snapshot-unavailable',
      snapshotFailures: [{ snapshotId: 'vite-v2', reason: 'snapshot-restore-failed: quota' }],
    });
    expect(phases).toEqual(['initial', 'snapshot-rejected']);
    expect(installCalls).toBe(0);
    await expect(vfs.exists(partial)).resolves.toBe(false);
    await expect(vfs.exists(`${ROOT}/node_modules`)).resolves.toBe(false);
  });

  it('records corrupt snapshot restore and falls through to the real installer', async () => {
    const vfs = await vfsHarness();
    const observations: AcquisitionObservation[] = [];
    const calls: string[] = [];
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      observe: (event) => observations.push(event),
      adapter: adapterWith({
        planSnapshotRestore: async () => {
          calls.push('snapshot');
          return { status: 'rejected', reason: 'archive checksum mismatch' };
        },
        install: async () => {
          calls.push('install');
          await seedTree(vfs);
          return { result: result(), packageJsonText: PACKAGE_JSON };
        },
      }),
    });

    await expect(
      authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        snapshot: {
          snapshotId: 'corrupt-vite',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'installed',
      eddyFallback: { reason: 'eddy bundle corrupt' },
    });
    expect(calls).toEqual(['snapshot', 'install']);
    expect(observations).toEqual([
      {
        type: 'snapshot-rejected',
        projectId: 'app',
        snapshotId: 'corrupt-vite',
        reason: 'archive checksum mismatch',
      },
    ]);
  });

  it('preserves snapshot rejection and the installer Eddy/registry cause chain', async () => {
    const vfs = await vfsHarness();
    const eddyCause = new Error('eddy timed out');
    const registryCause = new Error('registry returned 503');
    const installFailure = new Error('install failed', { cause: registryCause });
    Object.assign(installFailure, { eddyCause, registryCause });
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        planSnapshotRestore: async () => ({
          status: 'rejected',
          reason: 'snapshot JSON truncated',
        }),
        install: async () => {
          throw installFailure;
        },
      }),
    });

    let caught: unknown;
    try {
      await authority.dispatch({
        type: 'ensure',
        project: PROJECT,
        packageJsonText: PACKAGE_JSON,
        snapshot: {
          snapshotId: 'broken',
          identity: installArtifactIdentity,
          packageJsonText: PACKAGE_JSON,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PackageAcquisitionError);
    const failure = caught as PackageAcquisitionError;
    expect(failure.cause).toBe(installFailure);
    expect(failure.snapshotFailures).toEqual([
      { snapshotId: 'broken', reason: 'snapshot JSON truncated' },
    ]);
    expect((failure.cause as Error & { eddyCause: Error }).eddyCause).toBe(eddyCause);
    expect((failure.cause as Error & { registryCause: Error }).registryCause).toBe(registryCause);
    expect((failure.cause as Error).cause).toBe(registryCause);
  });

  it('preserves the exact AggregateError from final registry failure', async () => {
    const vfs = await vfsHarness();
    const eddyCause = new Error('Eddy acquisition failed: post: resolver returned HTTP 404');
    const registryCause = new Error('registry returned HTTP 503');
    const finalFailure = new AggregateError(
      [eddyCause, registryCause],
      'npm install failed after Eddy fallback',
    );
    const authority = createPackageAcquisitionAuthority({
      stamps: createInstallStampAuthority({ vfs }),
      adapter: adapterWith({
        install: async () => {
          throw finalFailure;
        },
      }),
    });

    let caught: unknown;
    try {
      await authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PackageAcquisitionError);
    expect((caught as PackageAcquisitionError).cause).toBe(finalFailure);
    expect([...(finalFailure.errors as unknown[])]).toEqual([eddyCause, registryCause]);
  });
});
