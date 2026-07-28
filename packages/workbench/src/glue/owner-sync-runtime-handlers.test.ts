import {
  SabRing,
  SyncRpcDispatcher,
  type SyncRpcReply,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '@riftydev/kernel';
import { planAppliedShadowSubstitutions } from '@riftydev/npm-client/internal';
import type { VfsMutationGuard, VfsMutationIntent } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerProjectVfsFrame } from '../workbench/project-vfs-protocol.ts';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import {
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
import { ProjectTerminalFsSync } from '../workers/project-terminal-namespace.ts';
import { createWorkbenchOwnerChildVfsMutationGuard } from '../workers/workbench-owner-child-vfs.ts';
import { createWorkbenchProjectVfs } from '../workers/workbench-project-vfs.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { installOwnerSyncRuntimeHandlers } from './owner-sync-runtime-handlers.ts';
import {
  type PackageEditPreflight,
  type PackageMutationExecutor,
  type PackageMutationTarget,
  applyPackageAwareVfsMutations,
  packageMutationTransitionsForProjects,
} from './package-mutation-executor.ts';

const ROOT = '/workspace';
const PACKAGE_JSON = '{"name":"app","dependencies":{"pkg":"1.0.0"}}\n';
const enc = new TextEncoder();
const dec = new TextDecoder();
const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};

const FS_METHODS = {
  writeChunk: 'fs.writeChunk',
  rm: 'fs.rm',
  rename: 'fs.rename',
} as const;

function base64(text: string): string {
  return btoa(text);
}

function mutationExecutor(
  packages: ReturnType<typeof createPackageAcquisitionAuthority>,
): PackageMutationExecutor {
  return {
    async guardedMutation<T>(
      intents: readonly VfsMutationIntent[],
      mutate: () => Promise<T>,
      preflight?: PackageEditPreflight<T>,
    ): Promise<T> {
      let completed = false;
      let value!: T;
      await packages.dispatch({
        type: 'guarded-mutation',
        ...(preflight
          ? {
              preflight: async () => {
                const result = await preflight();
                if (result.status === 'ready') return true;
                value = result.value;
                completed = true;
                return false;
              },
            }
          : {}),
        resolveTransitions: () => packageMutationTransitionsForProjects(intents, [PROJECT]),
        mutate: async () => {
          value = await mutate();
          completed = true;
        },
      });
      if (!completed) throw new Error('guarded mutation did not settle');
      return value;
    },
    reset: (target, prepare) => packages.dispatch({ type: 'reset', target, prepare }),
    async packageJsonEdit<T>(
      target: PackageMutationTarget,
      mutate: () => Promise<T>,
      preflight?: PackageEditPreflight<T>,
    ): Promise<T> {
      let completed = false;
      let value!: T;
      await packages.dispatch({
        type: 'package-json-edit',
        project: PROJECT,
        ...(preflight
          ? {
              preflight: async () => {
                const result = await preflight();
                if (result.status === 'ready') return true;
                value = result.value;
                completed = true;
                return false;
              },
            }
          : {}),
        mutate: async () => {
          value = await mutate();
          completed = true;
        },
      });
      if (!completed) throw new Error(`package.json edit did not run for ${target.root}`);
      return value;
    },
  };
}

async function roundTrip(
  dispatcher: SyncRpcDispatcher,
  method: string,
  payload: unknown,
): Promise<SyncRpcReply> {
  const { sab, ring } = createSabRing({ payloadCapacity: 2_048 });
  const caller = SabRing.attach(sab, 2_048);
  caller.writeRequest(encodeRequest({ method, payload }));
  dispatcher.pumpOnce(ring);
  return decodeReply(await caller.waitReplyAsync(5_000));
}

async function harness(
  options: {
    readonly parkInstall?: boolean;
    readonly projectPublication?: boolean;
    readonly projectFrame?: (frame: OwnerProjectVfsFrame) => void;
    readonly projectFatal?: (error: Error) => void;
  } = {},
) {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync(`${ROOT}/node_modules/pkg`, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
  fsSync.writeFileSync(`${ROOT}/node_modules/pkg/index.js`, enc.encode('trusted'));
  fsSync.writeFileSync(`${ROOT}/before.txt`, enc.encode('before'));
  const {
    authority: owner,
    appliedMutations,
    installStampClaims,
  } = createOwnerVfsAuthorityComposition(fsSync, {
    ownerEpoch: 'owner',
    initialRoots: ['/'],
  });
  const stamps = createInstallStampAuthority({ vfs, fsSync: owner, claimIo: installStampClaims });
  const claim = await stamps.demote(PROJECT);
  const promoted = await stamps.promote(
    { ...PROJECT, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1 },
  );
  if (promoted.status !== 'trusted') throw new Error('test setup failed to trust tree');

  let failTransitions = false;
  const transitionFailure = new Error('durable package transition failed');
  let releaseInstall!: () => void;
  let installStarted!: () => void;
  const installStart = new Promise<void>((resolve) => {
    installStarted = resolve;
  });
  const installGate = new Promise<void>((resolve) => {
    releaseInstall = resolve;
  });
  const packages = createPackageAcquisitionAuthority({
    stamps,
    stampTransition: {
      flush: async () => {
        if (failTransitions) throw transitionFailure;
        return { failures: [], total: 0 };
      },
    },
    adapter: {
      planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
      install: async () => {
        installStarted();
        if (options.parkInstall) await installGate;
        return {
          status: 'noop',
          packageJsonText: null,
          shadowPlan: planAppliedShadowSubstitutions([]),
        };
      },
      reset: async () => {},
      switchProject: async () => {},
    },
  });
  const mutations = mutationExecutor(packages);
  const projectVfs = options.projectPublication
    ? createWorkbenchProjectVfs({
        projectRoot: ROOT,
        authority: owner,
        appliedMutations,
        packageMutations: mutations,
        durability: 'ephemeral',
        emit: options.projectFrame ?? (() => {}),
        fatal: options.projectFatal ?? (() => {}),
      })
    : null;
  projectVfs?.publishSnapshot();
  const mutationGuard: VfsMutationGuard =
    projectVfs === null
      ? (intents, apply) => applyPackageAwareVfsMutations(mutations, ROOT, intents, apply)
      : createWorkbenchOwnerChildVfsMutationGuard({
          activeProject: () => ({ root: ROOT, vfs: projectVfs }),
        });
  const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
  installOwnerSyncRuntimeHandlers(dispatcher, () => owner, mutationGuard);

  return {
    owner,
    stamps,
    packages,
    projectVfs,
    dispatcher,
    installStart,
    releaseInstall,
    failTransitions: () => {
      failTransitions = true;
    },
  };
}

async function expectUntrusted(
  stamps: Awaited<ReturnType<typeof harness>>['stamps'],
): Promise<void> {
  await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.not.toMatchObject({
    status: 'trusted',
  });
}

describe('owner sync runtime package mutation guard', () => {
  it('publishes a real child rename state before the sync-RPC success reply', async () => {
    const timeline: string[] = [];
    const frames: OwnerProjectVfsFrame[] = [];
    const { owner, dispatcher } = await harness({
      projectPublication: true,
      projectFrame: (frame) => {
        frames.push(frame);
        if (frame.type === 'workbench:project-vfs-state') timeline.push('project-state');
      },
    });

    const reply = await roundTrip(dispatcher, FS_METHODS.rename, {
      src: `${ROOT}/before.txt`,
      dst: `${ROOT}/after.txt`,
    }).then((value) => {
      timeline.push(value.ok ? 'rpc-success' : 'rpc-error');
      return value;
    });

    expect(reply).toEqual({ ok: true, value: null });
    expect(timeline).toEqual(['project-state', 'rpc-success']);
    expect(owner.existsSync(`${ROOT}/before.txt`)).toBe(false);
    expect(owner.readFileBytesSync(`${ROOT}/after.txt`)).toEqual(enc.encode('before'));
    expect(frames.find((frame) => frame.type === 'workbench:project-vfs-state')).toMatchObject({
      type: 'workbench:project-vfs-state',
      mutations: [
        {
          kind: 'rename',
          sourcePath: `${ROOT}/before.txt`,
          targetPath: `${ROOT}/after.txt`,
        },
      ],
    });
  });

  // Fault classes: observable-order + torn-state. Applied child bytes cannot
  // receive a success reply when their owner state failed to reach the page.
  it('returns an RPC error and fatally ends the owner when child state publication fails', async () => {
    const failure = new Error('child project state delivery failed');
    const timeline: string[] = [];
    let ownerFatal: Error | null = null;
    const { owner, dispatcher } = await harness({
      projectPublication: true,
      projectFrame: (frame) => {
        if (frame.type === 'workbench:project-vfs-state') {
          timeline.push('project-state-attempt');
          throw failure;
        }
        if (frame.type === 'workbench:project-vfs-fatal') timeline.push('project-fatal');
      },
      projectFatal: (error) => {
        ownerFatal = error;
        timeline.push('owner-fatal');
      },
    });

    const reply = await roundTrip(dispatcher, FS_METHODS.rename, {
      src: `${ROOT}/before.txt`,
      dst: `${ROOT}/after.txt`,
    }).then((value) => {
      timeline.push(value.ok ? 'rpc-success' : 'rpc-error');
      return value;
    });

    expect(reply).toMatchObject({ ok: false });
    expect(timeline).toEqual([
      'project-state-attempt',
      'project-fatal',
      'owner-fatal',
      'rpc-error',
    ]);
    expect(ownerFatal).toBe(failure);
    expect(owner.existsSync(`${ROOT}/before.txt`)).toBe(false);
    expect(owner.readFileBytesSync(`${ROOT}/after.txt`)).toEqual(enc.encode('before'));
  });

  it('fences a real child package.json write through package trust transition', async () => {
    const { owner, stamps, dispatcher } = await harness();
    const path = `${ROOT}/package.json`;
    const text = '{"name":"changed"}\n';

    const reply = await roundTrip(dispatcher, FS_METHODS.writeChunk, {
      path,
      b64: base64(text),
      offset: 0,
      truncate: true,
    });

    expect(reply).toEqual({ ok: true, value: null });
    expect(dec.decode(owner.readFileBytesSync(path))).toBe(text);
    await expectUntrusted(stamps);
  });

  // ADR-0307: a child write inside the tree is extraneous — it applies with no
  // trust transition, matching real npm/Node.
  it('applies a child node_modules write without any trust transition', async () => {
    const { owner, stamps, dispatcher } = await harness();
    const path = `${ROOT}/node_modules/pkg/index.js`;

    const reply = await roundTrip(dispatcher, FS_METHODS.writeChunk, {
      path,
      b64: base64('changed'),
      offset: 0,
      truncate: true,
    });

    expect(reply).toEqual({ ok: true, value: null });
    expect(dec.decode(owner.readFileBytesSync(path))).toBe('changed');
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it.each([
    ['rm', FS_METHODS.rm, { path: ROOT, recursive: true, force: false }, false, ROOT],
    ['rename', FS_METHODS.rename, { src: ROOT, dst: '/moved-workspace' }, true, '/moved-workspace'],
  ])(
    'revokes before an ancestor %s dispatched through the real owner handler',
    async (_label, method, payload, expectedExists, expectedPath) => {
      const { owner, stamps, dispatcher } = await harness();

      const reply = await roundTrip(dispatcher, method, payload);

      expect(reply).toEqual({ ok: true, value: null });
      expect(owner.existsSync(ROOT)).toBe(false);
      expect(owner.existsSync(expectedPath)).toBe(expectedExists);
      await expectUntrusted(stamps);
    },
  );

  it('leaves an unrelated child path synchronous with package trust unchanged', async () => {
    const { owner, stamps, dispatcher } = await harness();

    const reply = await roundTrip(dispatcher, FS_METHODS.writeChunk, {
      path: '/outside.txt',
      b64: base64('outside'),
      offset: 0,
      truncate: true,
    });

    expect(reply).toEqual({ ok: true, value: null });
    expect(dec.decode(owner.readFileBytesSync('/outside.txt'))).toBe('outside');
    await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('parks an external child tree write behind an in-flight terminal install', async () => {
    const { owner, packages, dispatcher, installStart, releaseInstall } = await harness({
      parkInstall: true,
    });
    const install = packages.dispatch({
      type: 'terminal-install',
      project: PROJECT,
      argv: [],
    });
    await installStart;

    let writeSettled = false;
    const write = roundTrip(dispatcher, FS_METHODS.writeChunk, {
      path: `${ROOT}/node_modules/pkg/index.js`,
      b64: base64('after-install'),
      offset: 0,
      truncate: true,
    }).then((reply) => {
      writeSettled = true;
      return reply;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(writeSettled).toBe(false);
    expect(dec.decode(owner.readFileBytesSync(`${ROOT}/node_modules/pkg/index.js`))).toBe(
      'trusted',
    );

    releaseInstall();
    await expect(install).resolves.toBeUndefined();
    await expect(write).resolves.toEqual({ ok: true, value: null });
    expect(dec.decode(owner.readFileBytesSync(`${ROOT}/node_modules/pkg/index.js`))).toBe(
      'after-install',
    );
  });

  it('returns the exact revoke proof failure and never applies the ancestor rm', async () => {
    const { owner, dispatcher, failTransitions } = await harness();
    failTransitions();

    const reply = await roundTrip(dispatcher, FS_METHODS.rm, {
      path: ROOT,
      recursive: true,
      force: false,
    });

    expect(reply).toEqual({
      ok: false,
      error: {
        name: 'InstallStampAuthorityError',
        message: 'install-stamp revoke durability check failed',
        code: 'INSTALL_STAMP_REVOKE_UNPROVEN',
      },
    });
    expect(dec.decode(owner.readFileBytesSync(`${ROOT}/node_modules/pkg/index.js`))).toBe(
      'trusted',
    );
  });
});

describe('owner sync runtime child relay views', () => {
  // Fault classes: observable-order × sibling-drift. ENOENT preflight must not
  // mask recursive spawn; owner and child hops translate the same two views.
  it('keeps fs handlers unrooted while resolving recursive scripts through the scoped view', async () => {
    const { fsSync: relay } = createMemoryFs();
    const projectRoot = '/private/project';
    relay.mkdirSync(projectRoot, { recursive: true });
    relay.writeFileSync(`${projectRoot}/child.mjs`, enc.encode(''));
    const scoped = new ProjectTerminalFsSync(relay, projectRoot);
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    installOwnerSyncRuntimeHandlers(dispatcher, () => relay, undefined, {
      getVfs: () => scoped,
    });

    await expect(
      roundTrip(dispatcher, 'fs.exists', { path: `${projectRoot}/child.mjs` }),
    ).resolves.toEqual({ ok: true, value: true });
    await expect(roundTrip(dispatcher, 'fs.exists', { path: '/child.mjs' })).resolves.toEqual({
      ok: true,
      value: false,
    });

    const recursive = await roundTrip(dispatcher, 'execSync', {
      cmd: 'node child.mjs',
      opts: { cwd: '/', env: {} },
    });
    expect(recursive).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining('node-entry worker URL not configured'),
      },
    });
    expect(recursive).not.toMatchObject({
      error: { message: expect.stringContaining('script not found') },
    });
  });

  it('tracks the active project lifecycle and reads or spawns nothing after close', async () => {
    const { fsSync: authority } = createMemoryFs();
    const projectA = '/private/project-a';
    const projectB = '/private/project-b';
    authority.mkdirSync(projectA, { recursive: true });
    authority.mkdirSync(projectB, { recursive: true });
    authority.writeFileSync(`${projectA}/a.mjs`, enc.encode(''));
    authority.writeFileSync(`${projectB}/b.mjs`, enc.encode(''));
    let activeProjectRoot: string | null = null;
    let ownerReads = 0;
    const runWorker = vi.fn(async () => ({
      stdout: enc.encode('ran'),
      stderr: new Uint8Array(),
      exitCode: 0,
    }));
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    installOwnerSyncRuntimeHandlers(dispatcher, () => authority, undefined, {
      getVfs: () => {
        if (activeProjectRoot === null) {
          throw new Error('Workbench owner execSync requires an active project');
        }
        ownerReads += 1;
        return new ProjectTerminalFsSync(authority, activeProjectRoot);
      },
      runWorker,
    });

    const preflight = (path: string) =>
      roundTrip(dispatcher, 'execSync', {
        cmd: `node ${path}`,
        opts: { cwd: '/', env: {} },
      });
    const expectResolved = async (path: string): Promise<void> => {
      await expect(preflight(path)).resolves.toMatchObject({ ok: true });
    };
    const expectMissing = async (path: string): Promise<void> => {
      await expect(preflight(path)).resolves.toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('script not found') },
      });
    };

    const readsBeforeOpen = ownerReads;
    const spawnsBeforeOpen = runWorker.mock.calls.length;
    await expect(preflight(`${projectA}/a.mjs`)).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('requires an active project') },
    });
    expect(ownerReads).toBe(readsBeforeOpen);
    expect(runWorker).toHaveBeenCalledTimes(spawnsBeforeOpen);

    activeProjectRoot = projectA;
    await expectResolved('/a.mjs');
    expect(runWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ entryPath: '/a.mjs', cwd: '/' }),
      undefined,
    );
    await expectMissing('/b.mjs');
    activeProjectRoot = projectB;
    await expectResolved('/b.mjs');
    expect(runWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ entryPath: '/b.mjs', cwd: '/' }),
      undefined,
    );
    await expectMissing('/a.mjs');

    activeProjectRoot = null;
    const readsAfterClose = ownerReads;
    const spawnsAfterClose = runWorker.mock.calls.length;
    await expect(preflight(`${projectB}/b.mjs`)).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('requires an active project') },
    });
    expect(ownerReads).toBe(readsAfterClose);
    expect(runWorker).toHaveBeenCalledTimes(spawnsAfterClose);
  });
});
