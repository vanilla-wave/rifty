import { type GitIdentity, makeGit, vfsToGitFs } from '@riftydev/git';
import { RegistryClient } from '@riftydev/npm-client';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import type {
  OwnerPlaygroundSessionToolsFrame,
  PagePlaygroundSessionToolsFrame,
  PlaygroundSessionToolOperation,
  PlaygroundSessionToolResult,
} from '../workbench/internal/playground-session-tools-transport.ts';
import type { OwnerProjectVfsFrame } from '../workbench/project-vfs-protocol.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createOwnerPlaygroundSessionTools } from './playground-session-tools-owner.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const SOURCE = `${PROJECT_ROOT}/src/main.ts`;
const PACKAGE_JSON = '{"name":"project-a","version":"1.0.0"}\n';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const COMMIT_IDENTITY: GitIdentity = Object.freeze({
  name: 'Session Tools Contract',
  email: 'session-tools@rifty.test',
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
});

function write(
  authority: ReturnType<typeof createOwnerVfsAuthorityComposition>['authority'],
  path: string,
  text: string,
): void {
  authority.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  authority.writeFileSync(path, encoder.encode(text));
}

function archive(files: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    version: 1,
    root: '/',
    files: Object.entries(files).map(([path, content]) => ({
      path,
      encoding: 'base64',
      content: btoa(String.fromCharCode(...encoder.encode(content))),
    })),
  });
}

describe('owner-resident Playground session tools', () => {
  it('executes every SCM/archive sibling against real Git/VFS and returns owner-applied revisions', async () => {
    const fs = new MemoryFsSync();
    const vfs = new SyncMirrorVfs();
    const owner = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'session-tools-owner',
      initialRoots: ['/', '/.rifty'],
    });
    setSyncMirror(owner.authority, { async: vfs });
    write(owner.authority, `${PROJECT_ROOT}/package.json`, PACKAGE_JSON);
    write(owner.authority, SOURCE, 'export const value = 1;\n');

    const git = makeGit({ fs: vfsToGitFs(vfs), dir: PROJECT_ROOT });
    await git.init();
    await git.add('package.json');
    await git.add('src/main.ts');
    await git.commit({
      message: 'initial',
      author: COMMIT_IDENTITY,
      committer: COMMIT_IDENTITY,
    });

    const packages = createOwnerPackageState({
      vfs,
      fsSync: owner.authority,
      installStampClaims: owner.installStampClaims,
      flush: () => owner.authority.flush(),
      nodeWorkerRuntimeEnv: {},
      log: () => {},
      registry: new RegistryClient({
        baseUrl: 'https://registry.invalid/',
        fetch: async () => new Response('', { status: 599 }),
      }),
      resolverUrl: () => undefined,
      resolverBundleBaseUrl: () => undefined,
      resolverPin: () => undefined,
    });
    const vfsFrames: OwnerProjectVfsFrame[] = [];
    const vfsFailures: Error[] = [];
    const projectVfs = createWorkbenchProjectVfs({
      projectRoot: PROJECT_ROOT,
      authority: owner.authority,
      appliedMutations: owner.appliedMutations,
      packageMutations: packages.mutations,
      durability: 'ephemeral',
      emit: (frame) => vfsFrames.push(frame),
      fatal: (error) => vfsFailures.push(error),
    });
    projectVfs.publishSnapshot();

    const frames: OwnerPlaygroundSessionToolsFrame[] = [];
    const recordMutation = vi.fn(async (_kind: 'scm' | 'archive', _treeRevision: number) => {});
    const service = await createOwnerPlaygroundSessionTools({
      projectRoot: PROJECT_ROOT,
      owner,
      packages,
      projectVfs,
      vfs,
      git,
      commitIdentity: COMMIT_IDENTITY,
      tsWorkerUrl: 'ts-lsp-worker.js',
      nodeWorkerRuntimeEnv: {},
      spawnTsWorker: () => {
        throw new Error('TS worker must remain lazy in the SCM/archive contract');
      },
      send(frame) {
        frames.push(structuredClone(frame));
        return undefined;
      },
      recordMutation,
      log: () => {},
    });
    expect(service.initialScmSnapshot.history).toHaveLength(1);
    expect(frames).toEqual([]);

    let requestSequence = 0;
    const call = async (
      operation: PlaygroundSessionToolOperation,
    ): Promise<PlaygroundSessionToolResult> => {
      const requestId = `owner-${String(++requestSequence)}`;
      const frame: PagePlaygroundSessionToolsFrame = {
        type: 'workbench:playground-session-tools-request',
        requestId,
        operation,
      };
      await service.handle(frame);
      const response = frames.find(
        (candidate) =>
          candidate.type === 'workbench:playground-session-tools-response' &&
          candidate.requestId === requestId,
      );
      if (response?.type !== 'workbench:playground-session-tools-response') {
        throw new Error(`missing owner response ${requestId}`);
      }
      if (!response.response.ok) throw new Error(response.response.error.message);
      return response.response.result;
    };

    await vfs.writeFile(SOURCE, 'export const value = 2;\n');
    await projectVfs.publicationBarrier();
    const refreshed = await call({ type: 'scm:refresh' });
    expect(refreshed).toMatchObject({
      type: 'scm:snapshot',
      snapshot: { changes: [{ path: '/src/main.ts', area: 'working' }] },
    });

    const diff = await call({
      type: 'scm:diff',
      change: { path: '/src/main.ts', code: ' M', area: 'working' },
    });
    expect(diff.type).toBe('scm:diff');
    if (diff.type === 'scm:diff') {
      expect(decoder.decode(diff.diff.original.bytes)).toBe('export const value = 1;\n');
      expect(decoder.decode(diff.diff.modified.bytes)).toBe('export const value = 2;\n');
    }
    expect(recordMutation).not.toHaveBeenCalled();

    expect(await call({ type: 'scm:stage', path: '/src/main.ts' })).toEqual({ type: 'scm:void' });
    expect(recordMutation).toHaveBeenLastCalledWith('scm', owner.authority.treeRevision);
    expect(await call({ type: 'scm:unstage', path: '/src/main.ts' })).toEqual({ type: 'scm:void' });
    expect(recordMutation).toHaveBeenLastCalledWith('scm', owner.authority.treeRevision);
    const beforeDiscard = owner.authority.treeRevision;
    const discarded = await call({ type: 'scm:discard', path: '/src/main.ts' });
    expect(discarded).toEqual({
      type: 'scm:revision',
      revision: {
        ownerEpoch: owner.authority.ownerEpoch,
        treeRevision: owner.authority.treeRevision,
      },
    });
    expect(owner.authority.treeRevision).toBeGreaterThan(beforeDiscard);
    expect(decoder.decode(owner.authority.readFileBytesSync(SOURCE))).toBe(
      'export const value = 1;\n',
    );

    await vfs.writeFile(SOURCE, 'export const value = 3;\n');
    await call({ type: 'scm:refresh' });
    await call({ type: 'scm:stage', path: '/src/main.ts' });
    const committed = await call({ type: 'scm:commit', message: 'update value' });
    expect(committed).toMatchObject({ type: 'scm:commit', oid: expect.any(String) });

    const exported = await call({ type: 'archive:export' });
    if (exported.type !== 'archive:export') throw new Error('expected archive export');
    expect(JSON.parse(exported.archiveJson)).toMatchObject({ version: 1, root: '/' });
    expect(exported.archiveJson).not.toContain(PROJECT_ROOT);

    const imported = await call({
      type: 'archive:import',
      archiveJson: archive({
        'package.json': PACKAGE_JSON,
        'src/imported.ts': 'export const imported = true;\n',
      }),
    });
    expect(imported).toEqual({
      type: 'archive:import',
      revision: {
        ownerEpoch: owner.authority.ownerEpoch,
        treeRevision: owner.authority.treeRevision,
      },
    });
    expect(owner.authority.statSyncOrNull(SOURCE)).toBeNull();
    expect(owner.authority.statSyncOrNull(`${PROJECT_ROOT}/.git`)?.isDirectory).toBe(true);
    expect(
      frames.some((frame) => frame.type === 'workbench:playground-session-tools-scm-snapshot'),
    ).toBe(true);
    expect(recordMutation).toHaveBeenLastCalledWith('archive', owner.authority.treeRevision);
    expect(recordMutation.mock.calls.map(([kind]) => kind)).toEqual([
      'scm',
      'scm',
      'scm',
      'scm',
      'scm',
      'archive',
    ]);

    const beforeDuplicate = frames.length;
    await expect(
      service.handle({
        type: 'workbench:playground-session-tools-request',
        requestId: 'owner-1',
        operation: { type: 'scm:refresh' },
      }),
    ).rejects.toThrow('duplicate');
    expect(frames).toHaveLength(beforeDuplicate);

    const closeRequestId = 'owner-close';
    await service.handle({
      type: 'workbench:playground-session-tools-request',
      requestId: closeRequestId,
      operation: { type: 'close' },
    });
    expect(
      frames.find(
        (frame) =>
          frame.type === 'workbench:playground-session-tools-response' &&
          frame.requestId === closeRequestId,
      ),
    ).toEqual({
      type: 'workbench:playground-session-tools-response',
      requestId: closeRequestId,
      response: { ok: true, result: { type: 'closed' } },
    });
    await expect(
      service.handle({
        type: 'workbench:playground-session-tools-request',
        requestId: 'after-close',
        operation: { type: 'scm:refresh' },
      }),
    ).rejects.toBeInstanceOf(ClosedHandleError);

    await service.close();
    await packages.quiesce();
    await projectVfs.close();
    expect(vfsFailures).toEqual([]);
    expect(vfsFrames.length).toBeGreaterThan(0);
  });
});
