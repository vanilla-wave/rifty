import {
  SabRing,
  SyncRpcDispatcher,
  type SyncRpcReply,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '@riftydev/kernel';
import type { VfsMutationGuard, VfsMutationIntent } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import type { OwnerProjectVfsFrame } from '../workbench/project-vfs-protocol.ts';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import {
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
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
const PACKAGE_LOCK = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
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
  fsSync.writeFileSync(`${ROOT}/package-lock.json`, enc.encode(PACKAGE_LOCK));
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
        return { status: 'noop' };
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

  it.each([
    ['package.json', `${ROOT}/package.json`, '{"name":"changed"}\n'],
    ['node_modules child', `${ROOT}/node_modules/pkg/index.js`, 'changed'],
  ])(
    'fences a real child %s write through package trust transition',
    async (_label, path, text) => {
      const { owner, stamps, dispatcher } = await harness();

      const reply = await roundTrip(dispatcher, FS_METHODS.writeChunk, {
        path,
        b64: base64(text),
        offset: 0,
        truncate: true,
      });

      expect(reply).toEqual({ ok: true, value: null });
      expect(dec.decode(owner.readFileBytesSync(path))).toBe(text);
      await expectUntrusted(stamps);
    },
  );

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

  it('returns the exact revoke proof failure and never applies the child write', async () => {
    const { owner, dispatcher, failTransitions } = await harness();
    failTransitions();
    const path = `${ROOT}/node_modules/pkg/index.js`;

    const reply = await roundTrip(dispatcher, FS_METHODS.writeChunk, {
      path,
      b64: base64('must-not-land'),
      offset: 0,
      truncate: true,
    });

    expect(reply).toEqual({
      ok: false,
      error: {
        name: 'InstallStampAuthorityError',
        message: 'install-stamp revoke durability check failed',
        code: 'INSTALL_STAMP_REVOKE_UNPROVEN',
      },
    });
    expect(dec.decode(owner.readFileBytesSync(path))).toBe('trusted');
  });
});
