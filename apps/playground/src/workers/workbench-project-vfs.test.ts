import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommitRequest } from '../glue/owner-vfs-protocol.ts';
import type {
  PackageEditPreflight,
  PackageMutationExecutor,
  PackageMutationIntents,
} from '../glue/package-mutation-executor.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
} from '../workbench/project-vfs-protocol.ts';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const OUTSIDE = '/.rifty/workbench/v1/projects/project-b/tree';
const OWNER_EPOCH = 'workbench-project-vfs-test';
const encoder = new TextEncoder();

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function isPending<T>(promise: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function harness() {
  const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
    ownerEpoch: OWNER_EPOCH,
    initialRoots: ['/'],
  });
  authority.mkdirSync(`${ROOT}/src/nested`, { recursive: true });
  authority.writeFileSync(`${ROOT}/src/main.ts`, encoder.encode('old'));
  authority.writeFileSync(`${ROOT}/src/nested/child.ts`, encoder.encode('child'));
  authority.mkdirSync(OUTSIDE, { recursive: true });
  authority.writeFileSync(`${OUTSIDE}/secret.ts`, encoder.encode('outside'));

  let guardedMutations = 0;
  const packageMutations: PackageMutationExecutor = {
    async guardedMutation<T>(
      _intents: PackageMutationIntents,
      mutate: () => Promise<T>,
      preflight?: PackageEditPreflight<T>,
    ): Promise<T> {
      guardedMutations += 1;
      const checked = await preflight?.();
      if (checked?.status === 'noop') return checked.value;
      return mutate();
    },
    async reset(): Promise<void> {
      throw new Error('reset is outside this contract');
    },
    async packageJsonEdit<T>(): Promise<T> {
      throw new Error('packageJsonEdit is outside this contract');
    },
  };
  const emitted: OwnerProjectVfsFrame[] = [];
  const vfs = createWorkbenchProjectVfs({
    projectRoot: ROOT,
    authority,
    packageMutations,
    durability: 'ephemeral',
    emit: (frame) => emitted.push(frame),
  });
  return {
    authority,
    emitted,
    packageMutations,
    vfs,
    guardedMutations: () => guardedMutations,
  };
}

function writeRequest(
  operationId: string,
  path: string,
  expectedVersion: string | null,
): HostCommitRequest {
  return {
    kind: 'write',
    operationId,
    path,
    data: encoder.encode('new'),
    expectedVersion,
  };
}

describe('Workbench project VFS owner adapter', () => {
  it('publishes only the active source tree and serves each read from one atomic snapshot', () => {
    const h = harness();

    h.vfs.publishSnapshot();
    expect(h.emitted[0]).toMatchObject({
      type: 'workbench:project-vfs-snapshot',
      frame: {
        type: 'snapshot',
        root: ROOT,
        ownerEpoch: OWNER_EPOCH,
        entries: expect.arrayContaining([
          expect.objectContaining({ path: `${ROOT}/src`, kind: 'dir' }),
          expect.objectContaining({ path: `${ROOT}/src/main.ts`, kind: 'file' }),
        ]),
      },
    });
    expect(JSON.stringify(h.emitted[0])).not.toContain(OUTSIDE);

    const snapshot = vi.spyOn(h.authority, 'snapshot');
    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-file',
      requestId: 'read-file-1',
      path: `${ROOT}/src/main.ts`,
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-read-file-result',
      requestId: 'read-file-1',
      ok: true,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
      entry: {
        path: `${ROOT}/src/main.ts`,
        kind: 'file',
        size: 3,
        content: encoder.encode('old'),
        version: h.authority.versionOf(`${ROOT}/src/main.ts`),
      },
    });

    snapshot.mockClear();
    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-directory',
      requestId: 'read-dir-1',
      path: `${ROOT}/src`,
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-read-directory-result',
      requestId: 'read-dir-1',
      ok: true,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
      entries: [
        {
          path: `${ROOT}/src/nested`,
          kind: 'dir',
          size: 0,
          version: h.authority.versionOf(`${ROOT}/src/nested`),
        },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          size: 3,
          version: h.authority.versionOf(`${ROOT}/src/main.ts`),
        },
      ],
    });
  });

  it('runs commit, snapshot, terminal retention, cleanup, and durability through existing authorities', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const expectedVersion = h.authority.versionOf(path);
    if (expectedVersion === null) throw new Error('test version missing');

    h.vfs.handleFrame({
      type: 'rifty:owner-vfs-commit',
      request: writeRequest('write-1', path, expectedVersion),
    });
    await settle();

    expect(h.guardedMutations()).toBe(1);
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    const terminal = h.emitted.find((frame) => frame.type === 'rifty:owner-vfs-commit-ack');
    if (terminal?.type !== 'rifty:owner-vfs-commit-ack') {
      throw new Error('commit terminal missing');
    }
    expect(h.emitted.map((frame) => frame.type)).toEqual([
      'workbench:project-vfs-snapshot',
      'rifty:owner-vfs-commit-ack',
    ]);
    expect(terminal).toMatchObject({
      operationId: 'write-1',
      ok: true,
      ack: {
        ownerEpoch: OWNER_EPOCH,
        versions: [{ path, version: h.authority.versionOf(path) }],
      },
    });
    expect(h.authority.retainedHostCommitTerminal('write-1')).toEqual(terminal);

    h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit-received', terminal });
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-released',
      terminal,
    });
    h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit-cleanup', terminal });
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-cleaned',
      terminal,
    });
    expect(h.authority.retainedHostCommitTerminal('write-1')).toBeNull();

    const flush = vi.spyOn(h.authority, 'flush');
    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'durability-1',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'durability-1',
      ok: true,
      receipt: {
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
        durability: 'ephemeral',
      },
    });
  });

  it('returns an exact read failure without making a second authority observation', () => {
    const h = harness();
    const snapshot = vi.spyOn(h.authority, 'snapshot');

    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-file',
      requestId: 'missing-file',
      path: `${ROOT}/missing.ts`,
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-read-file-result',
        requestId: 'missing-file',
        ok: false,
        error: {
          name: 'Error',
          message: `No file exists at ${ROOT}/missing.ts`,
        },
      },
    ]);
  });

  it.each([
    writeRequest('outside-write', `${OUTSIDE}/new.ts`, null),
    {
      kind: 'mkdir',
      operationId: 'outside-mkdir',
      path: `${ROOT}/../escaped`,
      expectedVersion: null,
    },
    {
      kind: 'remove',
      operationId: 'outside-remove',
      path: `${ROOT}-sibling`,
      expectedVersion: 'forged-version',
    },
    {
      kind: 'rename',
      operationId: 'outside-rename-source',
      sourcePath: `${OUTSIDE}/secret.ts`,
      targetPath: `${ROOT}/src/moved.ts`,
      expectedSourceVersion: 'forged-version',
      expectedTargetVersion: null,
    },
    {
      kind: 'rename',
      operationId: 'outside-rename-target',
      sourcePath: `${ROOT}/src/main.ts`,
      targetPath: `${OUTSIDE}/moved.ts`,
      expectedSourceVersion: 'forged-version',
      expectedTargetVersion: null,
    },
  ] satisfies readonly HostCommitRequest[])(
    'rejects an out-of-project $kind before mutation',
    (request) => {
      const h = harness();

      expect(() => h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit', request })).toThrow(
        TypeError,
      );
      expect(h.guardedMutations()).toBe(0);
      expect(h.authority.readFileBytesSync(`${OUTSIDE}/secret.ts`)).toEqual(
        encoder.encode('outside'),
      );
      expect(h.emitted).toEqual([]);
    },
  );

  it.each([
    {
      type: 'workbench:project-vfs-read-file',
      requestId: 'outside-file',
      path: `${OUTSIDE}/secret.ts`,
    },
    {
      type: 'workbench:project-vfs-read-directory',
      requestId: 'outside-dir',
      path: `${ROOT}/../escaped`,
    },
  ] satisfies readonly PageProjectVfsFrame[])(
    'rejects an out-of-project read before observing authority',
    (frame) => {
      const h = harness();
      const snapshot = vi.spyOn(h.authority, 'snapshot');

      expect(() => h.vfs.handleFrame(frame)).toThrow(TypeError);
      expect(snapshot).not.toHaveBeenCalled();
      expect(h.emitted).toEqual([]);
    },
  );

  it('fences new frames synchronously and joins an admitted delayed commit through terminal delivery', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const expectedVersion = h.authority.versionOf(path);
    if (expectedVersion === null) throw new Error('test version missing');
    const releaseMutation = deferred<void>();
    const originalGuard = h.vfs;
    const packageGate = vi
      .spyOn(h.packageMutations, 'guardedMutation')
      .mockImplementation(async (_intents, mutate) => {
        await releaseMutation.promise;
        return mutate();
      });

    const applying = Promise.resolve(
      originalGuard.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('delayed-write', path, expectedVersion),
      }),
    );
    const closing = originalGuard.close();

    expect(await isPending(closing)).toBe(true);
    expect(() =>
      originalGuard.handleFrame({ type: 'workbench:project-vfs-snapshot-request' }),
    ).toThrow(ClosedHandleError);
    expect(h.emitted).toEqual([]);

    releaseMutation.resolve();
    await expect(applying).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(packageGate).toHaveBeenCalledTimes(1);
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    expect(h.emitted.map((frame) => frame.type)).toEqual([
      'workbench:project-vfs-snapshot',
      'rifty:owner-vfs-commit-ack',
    ]);

    const outputCount = h.emitted.length;
    expect(() =>
      originalGuard.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('late-write', path, h.authority.versionOf(path)),
      }),
    ).toThrow(ClosedHandleError);
    await settle();
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    expect(h.emitted).toHaveLength(outputCount);
  });

  it('joins delayed durability ACK delivery before close resolves and rejects late barriers', async () => {
    const h = harness();
    const flushed = deferred<undefined>();
    vi.spyOn(h.authority, 'flush').mockImplementation(() => flushed.promise);

    const durability = Promise.resolve(
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-durability',
        barrierId: 'delayed-durability',
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
      }),
    );
    const closing = h.vfs.close();

    expect(await isPending(closing)).toBe(true);
    expect(h.emitted).toEqual([]);
    expect(() =>
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-durability',
        barrierId: 'late-durability',
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
      }),
    ).toThrow(ClosedHandleError);

    flushed.resolve(undefined);
    await expect(durability).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(h.emitted).toEqual([
      {
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: 'delayed-durability',
        ok: true,
        receipt: {
          ownerEpoch: OWNER_EPOCH,
          treeRevision: h.authority.treeRevision,
          durability: 'ephemeral',
        },
      },
    ]);
    await settle();
    expect(h.emitted).toHaveLength(1);
  });
});
