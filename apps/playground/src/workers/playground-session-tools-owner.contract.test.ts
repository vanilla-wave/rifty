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
const STAGED_DELETE = `${PROJECT_ROOT}/staged-delete.txt`;
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
    const backgroundFailures: Error[] = [];
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
      fatal: (error) => backgroundFailures.push(error),
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

    const beforeExternalMutation = frames.length;
    owner.authority.writeFileSync(SOURCE, encoder.encode('export const value = interim;\n'));
    projectVfs.publishSnapshot();
    owner.authority.writeFileSync(SOURCE, encoder.encode('export const value = 2;\n'));
    projectVfs.publishSnapshot();
    await vi.waitFor(() => {
      expect(
        frames
          .slice(beforeExternalMutation)
          .some(
            (frame) =>
              frame.type === 'workbench:playground-session-tools-scm-snapshot' &&
              frame.snapshot.changes.some(
                (change) => change.path === '/src/main.ts' && change.area === 'working',
              ),
          ),
      ).toBe(true);
    });
    expect(
      frames
        .slice(beforeExternalMutation)
        .filter((frame) => frame.type === 'workbench:playground-session-tools-scm-snapshot'),
    ).toHaveLength(1);
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

    const beforeGuardedMutation = frames.length;
    await projectVfs.mutationGuard([{ kind: 'write', path: `${PROJECT_ROOT}/package.json` }], () =>
      vfs.writeFile(
        `${PROJECT_ROOT}/package.json`,
        '{"name":"project-a","version":"1.0.0","description":"changed"}\n',
      ),
    );
    await vi.waitFor(() => {
      expect(
        frames
          .slice(beforeGuardedMutation)
          .some(
            (frame) =>
              frame.type === 'workbench:playground-session-tools-scm-snapshot' &&
              frame.snapshot.changes.some((change) => change.path === '/package.json'),
          ),
      ).toBe(true);
    });

    expect(await call({ type: 'scm:stage', path: '/src/main.ts' })).toEqual({ type: 'scm:void' });
    expect(recordMutation).toHaveBeenLastCalledWith('scm', owner.authority.treeRevision);
    await projectVfs.mutationGuard([{ kind: 'write', path: STAGED_DELETE }], () =>
      vfs.writeFile(STAGED_DELETE, 'staged add\n'),
    );
    expect(await call({ type: 'scm:stage', path: '/staged-delete.txt' })).toEqual({
      type: 'scm:void',
    });

    // Fault class: concurrent-same-key × owner writer/SCM reader. Later guest
    // writes must replace staged-only status with both MM and AD resource rows.
    const beforePostStageMutation = frames.length;
    await projectVfs.mutationGuard([{ kind: 'write', path: SOURCE }], () =>
      vfs.writeFile(SOURCE, 'export const value = 2;\nexport const working = true;\n'),
    );
    await projectVfs.mutationGuard([{ kind: 'rm', path: STAGED_DELETE }], () =>
      vfs.rm(STAGED_DELETE),
    );
    expect(backgroundFailures).toEqual([]);
    await vi.waitFor(
      () => {
        const snapshots = frames
          .slice(beforePostStageMutation)
          .filter((frame) => frame.type === 'workbench:playground-session-tools-scm-snapshot');
        expect(snapshots.at(-1)?.snapshot.changes).toEqual(
          expect.arrayContaining([
            { path: '/src/main.ts', code: 'MM', area: 'staged' },
            { path: '/src/main.ts', code: 'MM', area: 'working' },
            { path: '/staged-delete.txt', code: 'AD', area: 'staged' },
            { path: '/staged-delete.txt', code: 'AD', area: 'working' },
          ]),
        );
      },
      { timeout: 5_000 },
    );

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
      'scm',
      'archive',
    ]);

    // Fault class: provenance-lie. Post-import reflection belongs to the same
    // public archive boundary as replacement and durability settlement.
    recordMutation.mockRejectedValueOnce(
      new Error(`archive reflection failed at ${PROJECT_ROOT}-backup/private.ts`),
    );
    await service.handle({
      type: 'workbench:playground-session-tools-request',
      requestId: 'owner-archive-reflection-failed',
      operation: {
        type: 'archive:import',
        archiveJson: archive({
          'package.json': PACKAGE_JSON,
          'src/imported.ts': 'export const imported = true;\n',
        }),
      },
    });
    const reflectionFailure = frames.find(
      (frame) =>
        frame.type === 'workbench:playground-session-tools-response' &&
        frame.requestId === 'owner-archive-reflection-failed',
    );
    if (
      reflectionFailure?.type !== 'workbench:playground-session-tools-response' ||
      reflectionFailure.response.ok
    ) {
      throw new Error('expected failed archive reflection response');
    }
    expect(reflectionFailure.response.error.message).not.toContain(PROJECT_ROOT);
    expect(reflectionFailure.response.error.message).not.toContain('/-backup/private.ts');
    expect(reflectionFailure.response.error.message).toContain('[outside active project]');

    let releaseDurability!: () => void;
    const durabilityPending = new Promise<void>((resolve) => {
      releaseDurability = resolve;
    });
    const flush = vi
      .spyOn(owner.authority, 'flush')
      .mockImplementationOnce(() => durabilityPending.then(() => undefined));
    const durabilityRequest = service.handle({
      type: 'workbench:playground-session-tools-request',
      requestId: 'owner-durability',
      operation: { type: 'durability:flush' },
    } as unknown as PagePlaygroundSessionToolsFrame);
    durabilityRequest.catch(() => {});
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(
      frames.find(
        (frame) =>
          frame.type === 'workbench:playground-session-tools-response' &&
          frame.requestId === 'owner-durability',
      ),
    ).toBeUndefined();
    releaseDurability();
    await durabilityRequest;
    expect(
      frames.find(
        (frame) =>
          frame.type === 'workbench:playground-session-tools-response' &&
          frame.requestId === 'owner-durability',
      ),
    ).toEqual({
      type: 'workbench:playground-session-tools-response',
      requestId: 'owner-durability',
      response: { ok: true, result: { type: 'durability:void' } },
    });

    // Fault classes: provenance-lie + sibling-drift. Reserved owner entries
    // are outside the public project namespace even when nested under its root.
    flush.mockResolvedValueOnce({
      total: 3,
      failures: [
        { op: 'write', path: SOURCE, message: 'quota exceeded' },
        {
          op: 'write',
          path: `${PROJECT_ROOT}/.rifty/owner.json`,
          message: 'reserved metadata permission denied',
        },
        {
          op: 'write',
          path: '/.rifty/workbench/v1/catalog.json',
          message: 'catalog permission denied',
        },
      ],
    });
    await service.handle({
      type: 'workbench:playground-session-tools-request',
      requestId: 'owner-durability-failed',
      operation: { type: 'durability:flush' },
    } as unknown as PagePlaygroundSessionToolsFrame);
    expect(
      frames.find(
        (frame) =>
          frame.type === 'workbench:playground-session-tools-response' &&
          frame.requestId === 'owner-durability-failed',
      ),
    ).toMatchObject({
      response: {
        ok: false,
        error: {
          message: expect.stringContaining('write /src/main.ts: quota exceeded'),
        },
      },
    });
    const durabilityFailure = frames.find(
      (frame) =>
        frame.type === 'workbench:playground-session-tools-response' &&
        frame.requestId === 'owner-durability-failed',
    );
    if (
      durabilityFailure?.type !== 'workbench:playground-session-tools-response' ||
      durabilityFailure.response.ok
    ) {
      throw new Error('expected failed durability response');
    }
    expect(durabilityFailure.response.error.message).toContain(
      'write [outside active project]: catalog permission denied',
    );
    expect(durabilityFailure.response.error.message).not.toContain('/.rifty/owner.json');
    expect(durabilityFailure.response.error.message).toContain(
      'write [outside active project]: reserved metadata permission denied',
    );
    expect(durabilityFailure.response.error.message).not.toContain(PROJECT_ROOT);
    expect(durabilityFailure.response.error.message).not.toContain(
      '/.rifty/workbench/v1/catalog.json',
    );
    flush.mockRestore();

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
    const failedRefreshFrames: OwnerPlaygroundSessionToolsFrame[] = [];
    const failedRefreshes: Error[] = [];
    const failedService = await createOwnerPlaygroundSessionTools({
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
        throw new Error('TS worker must remain lazy in the SCM failure contract');
      },
      send(frame) {
        failedRefreshFrames.push(structuredClone(frame));
        return undefined;
      },
      fatal: (error) => failedRefreshes.push(error),
      log: () => {},
    });
    owner.authority.writeFileSync(
      `${PROJECT_ROOT}/.git/index`,
      encoder.encode('corrupt git index'),
    );
    projectVfs.publishSnapshot();
    await vi.waitFor(() => expect(failedRefreshes).toHaveLength(1));
    await expect(
      failedService.handle({
        type: 'workbench:playground-session-tools-request',
        requestId: 'after-background-failure',
        operation: { type: 'scm:refresh' },
      }),
    ).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(failedService.close()).rejects.toBe(failedRefreshes[0]);
    expect(failedRefreshFrames).toEqual([]);

    await packages.quiesce();
    await projectVfs.close();
    expect(backgroundFailures).toEqual([]);
    expect(vfsFailures).toEqual([]);
    expect(vfsFrames.length).toBeGreaterThan(0);
  });
});
