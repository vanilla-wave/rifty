import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from '../glue/install-stamp-authority.ts';
import type { InstallStamp } from '../glue/install-stamp.ts';
import {
  type PackageAcquisitionAdapter,
  type PackageAcquisitionAuthority,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';

const SOURCE_ROOT = '/projects/scratch';
const TARGET_ROOT = '/projects/saved';
const INSTALL_ROOT = '/projects/install';
const PACKAGE_JSON = '{"name":"saved","dependencies":{"dep":"1.0.0"}}\n';
const EMPTY_PACKAGE_JSON = '{"name":"install","private":true}\n';
const EMPTY_PLAN = planShadowSubstitutionsFromLockfile({
  lockfileVersion: 3,
  packages: {},
});

type ProjectSaveStampResult =
  | { readonly status: 'untrusted' }
  | { readonly status: 'trusted'; readonly stamp: InstallStamp };

interface ProjectSaveAuthority extends PackageAcquisitionAuthority {
  projectSave<T>(
    input: {
      readonly source: { readonly root: string; readonly slug: string };
      readonly target: { readonly root: string; readonly slug: string };
    },
    operation: (rebind: () => Promise<ProjectSaveStampResult>) => Promise<T>,
  ): Promise<T>;
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

function adapter(
  vfs: MemoryVfs,
  timeline: string[],
  installGate?: Promise<void>,
): PackageAcquisitionAdapter {
  return {
    readTrustedPackageLock: async () => ({ lockfileVersion: 3, packages: {} }),
    attestEmptyPackageTree: async () => true,
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'not requested' }),
    install: async () => {
      timeline.push('install:start');
      await installGate;
      await vfs.mkdir(`${INSTALL_ROOT}/node_modules`, { recursive: true });
      timeline.push('install:end');
      return {
        status: 'noop',
        shadowPlan: EMPTY_PLAN,
        packageJsonText: EMPTY_PACKAGE_JSON,
      };
    },
    reset: async () => {},
    switchProject: async () => {},
  };
}

async function seedSaveRoots(vfs: MemoryVfs, stamps: InstallStampAuthority): Promise<void> {
  for (const root of [SOURCE_ROOT, TARGET_ROOT]) {
    await vfs.mkdir(`${root}/node_modules/dep`, { recursive: true });
    await vfs.writeFile(`${root}/package.json`, PACKAGE_JSON);
    await vfs.writeFile(`${root}/node_modules/dep/package.json`, '{"version":"1.0.0"}\n');
  }
  const claim = await stamps.demote({ root: SOURCE_ROOT, slug: 'scratch' });
  await expect(
    stamps.promote(
      { root: SOURCE_ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
      { epoch: claim.epoch, packages: 1 },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });
}

async function setup(
  timeline: string[],
  installGate?: Promise<void>,
): Promise<{
  readonly authority: ProjectSaveAuthority;
  readonly installProject: PackageAcquisitionProject;
}> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(INSTALL_ROOT, { recursive: true });
  await vfs.writeFile(`${INSTALL_ROOT}/package.json`, EMPTY_PACKAGE_JSON);
  const stamps = createInstallStampAuthority({ vfs });
  await seedSaveRoots(vfs, stamps);
  const authority = createPackageAcquisitionAuthority({
    stamps,
    adapter: adapter(vfs, timeline, installGate),
  }) as ProjectSaveAuthority;
  return {
    authority,
    installProject: {
      projectId: 'install',
      root: INSTALL_ROOT,
      slug: 'install',
      identity: installArtifactIdentity,
    },
  };
}

describe('ADR-0329 package FIFO project Save', () => {
  it('orders an admitted install, the complete Save, then child admission', async () => {
    const timeline: string[] = [];
    const installGate = deferred<void>();
    const saveGate = deferred<void>();
    const { authority, installProject } = await setup(timeline, installGate.promise);

    const install = authority.dispatch({
      type: 'terminal-install',
      project: installProject,
      argv: [],
    });
    await expect.poll(() => timeline).toEqual(['install:start']);

    const save = authority.projectSave(
      {
        source: { root: SOURCE_ROOT, slug: 'scratch' },
        target: { root: TARGET_ROOT, slug: 'saved' },
      },
      async (rebind) => {
        timeline.push('save:start');
        await saveGate.promise;
        const result = await rebind();
        expect(result.status).toBe('trusted');
        timeline.push('save:end');
        return 'saved';
      },
    );
    let childSettled = false;
    const child = authority
      .reserveChildAdmission(`${INSTALL_ROOT}/src/main.ts`)
      .then((reservation) => {
        childSettled = true;
        timeline.push('child');
        reservation.commit();
      });

    await Promise.resolve();
    expect(timeline).toEqual(['install:start']);
    expect(childSettled).toBe(false);

    installGate.resolve();
    await install;
    await expect.poll(() => timeline).toEqual(['install:start', 'install:end', 'save:start']);
    expect(childSettled).toBe(false);

    saveGate.resolve();
    await expect(save).resolves.toBe('saved');
    await child;
    expect(timeline).toEqual(['install:start', 'install:end', 'save:start', 'save:end', 'child']);
  });

  it('holds later install and child admission until the complete Save settles', async () => {
    const timeline: string[] = [];
    const saveGate = deferred<void>();
    const { authority, installProject } = await setup(timeline);

    const save = authority.projectSave(
      {
        source: { root: SOURCE_ROOT, slug: 'scratch' },
        target: { root: TARGET_ROOT, slug: 'saved' },
      },
      async (rebind) => {
        timeline.push('save:start');
        await saveGate.promise;
        await rebind();
        timeline.push('save:end');
      },
    );
    const install = authority.dispatch({
      type: 'terminal-install',
      project: installProject,
      argv: [],
    });
    let childSettled = false;
    const child = authority
      .reserveChildAdmission(`${INSTALL_ROOT}/src/main.ts`)
      .then((reservation) => {
        childSettled = true;
        timeline.push('child');
        reservation.commit();
      });

    await expect.poll(() => timeline).toEqual(['save:start']);
    expect(childSettled).toBe(false);

    saveGate.resolve();
    await save;
    await install;
    await child;
    expect(timeline).toEqual(['save:start', 'save:end', 'install:start', 'install:end', 'child']);
  });

  it('waits for an earlier physical child reservation before Save and install', async () => {
    const timeline: string[] = [];
    const { authority, installProject } = await setup(timeline);
    await authority.dispatch({
      type: 'terminal-install',
      project: installProject,
      argv: [],
    });
    timeline.length = 0;

    const child = await authority.reserveChildAdmission(`${INSTALL_ROOT}/src/main.ts`);
    timeline.push('child:held');
    const save = authority.projectSave(
      {
        source: { root: SOURCE_ROOT, slug: 'scratch' },
        target: { root: TARGET_ROOT, slug: 'saved' },
      },
      async (rebind) => {
        timeline.push('save:start');
        await rebind();
        timeline.push('save:end');
      },
    );
    const install = authority.dispatch({
      type: 'terminal-install',
      project: installProject,
      argv: [],
    });

    await Promise.resolve();
    expect(timeline).toEqual(['child:held']);

    child.commit();
    await save;
    await install;
    expect(timeline).toEqual([
      'child:held',
      'save:start',
      'save:end',
      'install:start',
      'install:end',
    ]);
  });

  it('releases the existing FIFO after a failed Save without minting success', async () => {
    const timeline: string[] = [];
    const { authority, installProject } = await setup(timeline);
    const failure = new Error('catalog copy failed');

    const save = authority.projectSave(
      {
        source: { root: SOURCE_ROOT, slug: 'scratch' },
        target: { root: TARGET_ROOT, slug: 'saved' },
      },
      async () => {
        timeline.push('save:failed');
        throw failure;
      },
    );
    const install = authority.dispatch({
      type: 'terminal-install',
      project: installProject,
      argv: [],
    });

    await expect(save).rejects.toBe(failure);
    await install;
    expect(timeline).toEqual(['save:failed', 'install:start', 'install:end']);
    await authority.quiesce();
  });
});
