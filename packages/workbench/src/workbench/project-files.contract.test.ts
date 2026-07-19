import { describe, expect, it, vi } from 'vitest';
import type { HostCommitAck, OwnerVfsSnapshotEntry } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitAppliedError, VfsVersionConflictError } from '../glue/owner-vfs-protocol.ts';
import { VfsOwnerExitedError, createVfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import { ClosedHandleError, FileConflictError, ProjectFileOperationError } from './errors.ts';
import { SnapshotFs } from './internal/snapshot-fs.ts';
import { createProjectFileVersionBoundary } from './project-file-boundary.ts';
import { createProjectFilesController } from './project-files.ts';
import type { VfsSnapshotFrame } from './project-vfs-contract.ts';

const ROOT = '/.rifty/workbench/projects/p-1';
const OWNER_EPOCH = 'owner-files-contract';
const encoder = new TextEncoder();

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function publicStrings(value: unknown, seen = new Set<object>()): readonly string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Reflect.ownKeys(value).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const name = typeof key === 'string' ? [key] : [];
    return descriptor !== undefined && 'value' in descriptor
      ? [...name, ...publicStrings(descriptor.value, seen)]
      : name;
  });
}

function expectNoOwnerInternals(value: unknown): void {
  const evidence = publicStrings(value).join('\n');
  expect(evidence).not.toContain(ROOT);
  expect(evidence).not.toContain(OWNER_EPOCH);
  for (const privateKey of ['ownerEpoch', 'treeRevision', 'operationId', 'ack']) {
    expect(publicStrings(value)).not.toContain(privateKey);
  }
}

function frame(
  treeRevision: number,
  entries: readonly {
    readonly path: string;
    readonly kind: 'file' | 'dir';
    readonly version: string;
    readonly bytes?: Uint8Array;
  }[],
): VfsSnapshotFrame {
  return {
    type: 'snapshot',
    root: ROOT,
    ownerEpoch: OWNER_EPOCH,
    treeRevision,
    nodeModulesPresent: false,
    entries: entries.map((entry) =>
      entry.kind === 'dir'
        ? { path: entry.path, kind: 'dir', size: 0, version: entry.version }
        : {
            path: entry.path,
            kind: 'file',
            size: entry.bytes?.byteLength ?? 0,
            version: entry.version,
            content: entry.bytes?.slice() ?? new Uint8Array(),
          },
    ),
  };
}

async function nextTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function isPending<T>(promise: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

function harness(options: { readonly timeoutMs?: number } = {}) {
  const versions = createProjectFileVersionBoundary('project-files-contract');
  const snapshots = new SnapshotFs(ROOT);
  snapshots.bindOwner(OWNER_EPOCH, ROOT);
  snapshots.update(
    frame(1, [
      { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v1' },
      {
        path: `${ROOT}/src/main.ts`,
        kind: 'file',
        version: 'file-v1',
        bytes: encoder.encode('old'),
      },
    ]),
  );
  const ownerClosed = deferred<unknown>();
  const durability = deferred<{
    ownerEpoch: string;
    treeRevision: number;
    durability: 'durable';
  }>();
  let apply: (
    request: Parameters<ReturnType<typeof createVfsCommitCoordinator>['commit']>[0] & {
      readonly operationId: string;
    },
  ) => Promise<HostCommitAck> = async (request) => ({
    operationId: request.operationId,
    ownerEpoch: OWNER_EPOCH,
    treeRevision: 2,
    versions: [{ path: `${ROOT}/src/main.ts`, version: 'file-v2' }],
  });
  const applyHostCommit = vi.fn((request: Parameters<typeof apply>[0]) => apply(request));
  const durabilityBarrier = vi.fn(() => durability.promise);
  const coordinator = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch: OWNER_EPOCH,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit,
      durabilityBarrier,
    }),
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: options.timeoutMs ?? 1_000,
  });
  const readBytes = encoder.encode('old');
  const readVersionedFile = vi.fn(
    async (path: string): Promise<OwnerVfsSnapshotEntry> => ({
      path,
      kind: 'file',
      size: 3,
      content: readBytes,
      version: 'file-v1',
    }),
  );
  const readVersionedDirectory = vi.fn(async (path: string) => [
    {
      path: `${path}/main.ts`,
      kind: 'file' as const,
      size: 3,
      version: 'file-v1',
    },
  ]);
  const controller = createProjectFilesController({
    projectRoot: ROOT,
    versions,
    snapshots,
    committer: coordinator,
    readVersionedFile,
    readVersionedDirectory,
  });
  return {
    snapshots,
    ownerClosed,
    durability,
    applyHostCommit,
    durabilityBarrier,
    readVersionedFile,
    readVersionedDirectory,
    readBytes,
    controller,
    version: (ownerVersion: string) => versions.toPublic(ownerVersion),
    setApply(next: typeof apply) {
      apply = next;
    },
  };
}

describe('ProjectSession files contract', () => {
  it('claims a write before returning, then waits for exact reflection and durability', async () => {
    const h = harness();
    const bytes = encoder.encode('new');

    const writing = h.controller.files.writeFile('/src/main.ts', bytes, {
      expectedVersion: h.version('file-v1'),
    });

    expect(h.applyHostCommit).toHaveBeenCalledTimes(1);
    const request = h.applyHostCommit.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v1',
    });
    if (request?.kind !== 'write') throw new Error('write request was not captured');
    expect(request.data).toEqual(bytes);
    bytes[0] = 0;
    expect(request.data).toEqual(encoder.encode('new'));

    await nextTurn();
    expect(await isPending(writing)).toBe(true);
    expect(h.durabilityBarrier).not.toHaveBeenCalled();

    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v2',
          bytes: encoder.encode('new'),
        },
      ]),
    );
    await nextTurn();
    expect(h.durabilityBarrier).toHaveBeenCalledWith(2);
    expect(await isPending(writing)).toBe(true);

    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(writing).resolves.toEqual({
      path: '/src/main.ts',
      version: h.version('file-v2'),
    });
  });

  it('creates an absent file only with expectedVersion null', async () => {
    const h = harness();
    h.setApply(async (request) => ({
      operationId: request.operationId,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      versions: [{ path: `${ROOT}/src/new.ts`, version: 'new-v1' }],
    }));

    const creating = h.controller.files.writeFile('/src/new.ts', encoder.encode('new'), {
      expectedVersion: null,
    });
    expect(h.applyHostCommit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/new.ts`,
      expectedVersion: null,
    });
    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v1',
          bytes: encoder.encode('old'),
        },
        {
          path: `${ROOT}/src/new.ts`,
          kind: 'file',
          version: 'new-v1',
          bytes: encoder.encode('new'),
        },
      ]),
    );
    await nextTurn();
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(creating).resolves.toEqual({
      path: '/src/new.ts',
      version: h.version('new-v1'),
    });
  });

  it('creates a directory only with absent CAS and returns its owner version', async () => {
    const h = harness();
    h.setApply(async (request) => ({
      operationId: request.operationId,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      versions: [{ path: `${ROOT}/assets`, version: 'assets-v1' }],
    }));

    const creating = h.controller.files.mkdir('/assets', { expectedVersion: null });
    expect(h.applyHostCommit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'mkdir',
      path: `${ROOT}/assets`,
      expectedVersion: null,
    });
    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/assets`, kind: 'dir', version: 'assets-v1' },
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v1' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v1',
          bytes: encoder.encode('old'),
        },
      ]),
    );
    await nextTurn();
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(creating).resolves.toEqual({
      path: '/assets',
      version: h.version('assets-v1'),
    });
  });

  it('preserves exact same-length remote bytes on a stale conflict and never retries', async () => {
    const h = harness();
    const remote = encoder.encode('new');
    h.setApply(async (_request) => {
      throw new VfsVersionConflictError({
        path: `${ROOT}/src/main.ts`,
        expectedVersion: 'file-v1',
        actualVersion: 'file-v2',
        actualEntry: {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          size: remote.byteLength,
          content: remote,
          version: 'file-v2',
        },
        ownerEpoch: OWNER_EPOCH,
        treeRevision: 2,
      });
    });

    const local = encoder.encode('our');
    const failure = await h.controller.files
      .writeFile('/src/main.ts', local, { expectedVersion: h.version('file-v1') })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(FileConflictError);
    expect(failure).toMatchObject({
      path: '/src/main.ts',
      expectedVersion: h.version('file-v1'),
      actualVersion: h.version('file-v2'),
    });
    expect((failure as FileConflictError).actualEntry).toEqual({
      path: '/src/main.ts',
      kind: 'file',
      size: 3,
      version: h.version('file-v2'),
    });
    expect((failure as FileConflictError).actualBytes).toEqual(encoder.encode('new'));
    expectNoOwnerInternals(failure);
    remote[0] = 0;
    expect((failure as FileConflictError).actualBytes).toEqual(encoder.encode('new'));
    expect(h.applyHostCommit).toHaveBeenCalledTimes(1);
    expect(h.durabilityBarrier).not.toHaveBeenCalled();
  });

  it('maps directory and absent conflict entries without owner evidence', async () => {
    const directory = harness();
    directory.setApply(async (_request) => {
      throw new VfsVersionConflictError({
        path: `${ROOT}/assets`,
        expectedVersion: null,
        actualVersion: 'assets-v1',
        actualEntry: {
          path: `${ROOT}/assets`,
          kind: 'dir',
          size: 0,
          version: 'assets-v1',
        },
        ownerEpoch: OWNER_EPOCH,
        treeRevision: 2,
      });
    });
    const directoryFailure = await directory.controller.files
      .mkdir('/assets', { expectedVersion: null })
      .catch((error: unknown) => error);
    expect(directoryFailure).toBeInstanceOf(FileConflictError);
    expect((directoryFailure as FileConflictError).actualEntry).toEqual({
      path: '/assets',
      kind: 'dir',
      size: 0,
      version: directory.version('assets-v1'),
    });
    expect((directoryFailure as FileConflictError).actualBytes).toBeNull();
    expectNoOwnerInternals(directoryFailure);

    const absent = harness();
    absent.setApply(async (_request) => {
      throw new VfsVersionConflictError({
        path: `${ROOT}/src/main.ts`,
        expectedVersion: 'file-v1',
        actualVersion: null,
        actualEntry: null,
        ownerEpoch: OWNER_EPOCH,
        treeRevision: 3,
      });
    });
    const absentFailure = await absent.controller.files
      .remove('/src/main.ts', { expectedVersion: absent.version('file-v1') })
      .catch((error: unknown) => error);
    expect(absentFailure).toBeInstanceOf(FileConflictError);
    expect((absentFailure as FileConflictError).actualEntry).toBeNull();
    expect((absentFailure as FileConflictError).actualBytes).toBeNull();
    expectNoOwnerInternals(absentFailure);
  });

  it('maps applied, timeout, owner-exit, and read failures to safe public evidence', async () => {
    const applied = harness();
    applied.setApply(async (request) => {
      throw new VfsCommitAppliedError(
        {
          operationId: request.operationId,
          ownerEpoch: OWNER_EPOCH,
          treeRevision: 2,
          versions: [{ path: `${ROOT}/src/main.ts`, version: 'file-v2' }],
        },
        new Error(`post-apply failure at ${ROOT} from ${OWNER_EPOCH}`),
      );
    });
    const appliedFailure = await applied.controller.files
      .writeFile('/src/main.ts', encoder.encode('new'), {
        expectedVersion: applied.version('file-v1'),
      })
      .catch((error: unknown) => error);
    expect(appliedFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(appliedFailure).toMatchObject({
      operation: 'writeFile',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(appliedFailure);

    const durability = harness();
    const awaitingDurability = durability.controller.files.writeFile(
      '/src/main.ts',
      encoder.encode('new'),
      { expectedVersion: durability.version('file-v1') },
    );
    durability.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v2',
          bytes: encoder.encode('new'),
        },
      ]),
    );
    await nextTurn();
    durability.durability.reject(new Error(`durability failed below ${ROOT} in ${OWNER_EPOCH}`));
    const durabilityFailure = await awaitingDurability.catch((error: unknown) => error);
    expect(durabilityFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(durabilityFailure).toMatchObject({
      operation: 'writeFile',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(durabilityFailure);

    const timedOut = harness({ timeoutMs: 1 });
    const timeoutFailure = await timedOut.controller.files
      .writeFile('/src/main.ts', encoder.encode('new'), {
        expectedVersion: timedOut.version('file-v1'),
      })
      .catch((error: unknown) => error);
    expect(timeoutFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(timeoutFailure).toMatchObject({
      operation: 'writeFile',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(timeoutFailure);

    const exited = harness();
    const ownerApply = deferred<HostCommitAck>();
    exited.setApply(() => ownerApply.promise);
    const interrupted = exited.controller.files.writeFile('/src/main.ts', encoder.encode('new'), {
      expectedVersion: exited.version('file-v1'),
    });
    exited.ownerClosed.resolve(
      new VfsOwnerExitedError(OWNER_EPOCH, new Error(`owner lost at ${ROOT}`)),
    );
    const exitFailure = await interrupted.catch((error: unknown) => error);
    expect(exitFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(exitFailure).toMatchObject({
      operation: 'writeFile',
      path: '/src/main.ts',
      mutationOutcome: 'unknown',
    });
    expectNoOwnerInternals(exitFailure);

    const exitedAfterAck = harness();
    const appliedBeforeExit = exitedAfterAck.controller.files.writeFile(
      '/src/main.ts',
      encoder.encode('new'),
      { expectedVersion: exitedAfterAck.version('file-v1') },
    );
    await nextTurn();
    exitedAfterAck.ownerClosed.resolve(new Error(`owner exited below ${ROOT}`));
    const afterAckFailure = await appliedBeforeExit.catch((error: unknown) => error);
    expect(afterAckFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(afterAckFailure).toMatchObject({
      operation: 'writeFile',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(afterAckFailure);

    const rename = harness();
    rename.setApply(async () => {
      throw new Error(`rename transport failed below ${ROOT} in ${OWNER_EPOCH}`);
    });
    const renameFailure = await rename.controller.files
      .rename('/src/main.ts', '/src/target.ts', {
        expectedSourceVersion: rename.version('file-v1'),
        expectedTargetVersion: null,
      })
      .catch((error: unknown) => error);
    expect(renameFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(renameFailure).toMatchObject({
      operation: 'rename',
      path: '/src/main.ts',
      targetPath: '/src/target.ts',
      mutationOutcome: 'unknown',
    });
    expectNoOwnerInternals(renameFailure);

    const read = harness();
    read.readVersionedFile.mockRejectedValueOnce(
      new Error(`read failed below ${ROOT} in ${OWNER_EPOCH}`),
    );
    const readFailure = await read.controller.files
      .readFile('/src/main.ts')
      .catch((error: unknown) => error);
    expect(readFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(readFailure).toMatchObject({
      operation: 'readFile',
      path: '/src/main.ts',
      mutationOutcome: null,
    });
    expectNoOwnerInternals(readFailure);
  });

  it('rejects every invalid public path before read or mutation transport', async () => {
    const h = harness();
    const invalid = [
      '',
      'src/main.ts',
      '//src/main.ts',
      '/src//main.ts',
      '/src/',
      '/src/./main.ts',
      '/src/../main.ts',
      '/.rifty',
      '/.rifty/owner.json',
      '/src/\0main.ts',
    ];

    for (const path of invalid) {
      await expect(h.controller.files.readFile(path)).rejects.toBeInstanceOf(TypeError);
      await expect(h.controller.files.readdir(path)).rejects.toBeInstanceOf(TypeError);
      await expect(
        h.controller.files.writeFile(path, encoder.encode('x'), { expectedVersion: null }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        h.controller.files.mkdir(path, { expectedVersion: null }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        h.controller.files.rename(path, '/src/target.ts', {
          expectedSourceVersion: h.version('file-v1'),
          expectedTargetVersion: null,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        h.controller.files.rename('/src/main.ts', path, {
          expectedSourceVersion: h.version('file-v1'),
          expectedTargetVersion: null,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        h.controller.files.remove(path, { expectedVersion: h.version('file-v1') }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    for (const operation of [
      () => h.controller.files.writeFile('/', encoder.encode('x'), { expectedVersion: null }),
      () => h.controller.files.mkdir('/', { expectedVersion: null }),
      () =>
        h.controller.files.rename('/', '/src/target.ts', {
          expectedSourceVersion: h.version('dir-v1'),
          expectedTargetVersion: null,
        }),
      () =>
        h.controller.files.rename('/src/main.ts', '/', {
          expectedSourceVersion: h.version('file-v1'),
          expectedTargetVersion: null,
        }),
      () =>
        h.controller.files.remove('/', {
          expectedVersion: h.version('dir-v1'),
          recursive: true,
        }),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(TypeError);
    }
    expect(h.applyHostCommit).not.toHaveBeenCalled();
    expect(h.readVersionedFile).not.toHaveBeenCalled();
    expect(h.readVersionedDirectory).not.toHaveBeenCalled();
  });

  it('rejects non-byte writes at runtime before transport', async () => {
    const h = harness();

    await expect(
      h.controller.files.writeFile('/src/main.ts', 'text' as unknown as Uint8Array, {
        expectedVersion: h.version('file-v1'),
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(h.applyHostCommit).not.toHaveBeenCalled();
  });

  it('never exposes physical root, owner identity, or revision in snapshots', () => {
    const h = harness();
    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v2',
          bytes: encoder.encode('new'),
        },
        { path: `${ROOT}/node_modules`, kind: 'dir', version: 'nm-v1' },
        { path: `${ROOT}/node_modules/pkg`, kind: 'dir', version: 'pkg-v1' },
        {
          path: `${ROOT}/node_modules/pkg/index.js`,
          kind: 'file',
          version: 'pkg-file-v1',
          bytes: encoder.encode('module.exports = 1'),
        },
        { path: `${ROOT}/.git`, kind: 'dir', version: 'git-v1' },
        { path: `${ROOT}/.vite`, kind: 'dir', version: 'vite-v1' },
        { path: `${ROOT}/dist`, kind: 'dir', version: 'dist-v1' },
      ]),
    );

    const snapshot = h.controller.files.snapshot();
    expect(snapshot).toEqual({
      excludedDirectoryNames: ['node_modules', '.git', '.vite', 'dist'],
      entries: [
        { path: '/src', kind: 'dir', size: 0, version: h.version('dir-v2') },
        {
          path: '/src/main.ts',
          kind: 'file',
          size: 3,
          version: h.version('file-v2'),
        },
      ],
    });
    expectNoOwnerInternals(snapshot);
    expect(Reflect.ownKeys(snapshot)).not.toContain('treeRevision');
  });

  it('provides atomic project-rooted reads and exact directory metadata', async () => {
    const h = harness();

    const first = await h.controller.files.readFile('/src/main.ts');
    expect(first).toEqual({
      path: '/src/main.ts',
      bytes: encoder.encode('old'),
      version: h.version('file-v1'),
    });
    first.bytes[0] = 0;
    expect(h.readBytes).toEqual(encoder.encode('old'));
    await expect(h.controller.files.readFile('/src/main.ts')).resolves.toEqual({
      path: '/src/main.ts',
      bytes: encoder.encode('old'),
      version: h.version('file-v1'),
    });
    expect(h.readVersionedFile).toHaveBeenCalledWith(`${ROOT}/src/main.ts`);

    await expect(h.controller.files.readdir('/src')).resolves.toEqual([
      {
        path: '/src/main.ts',
        kind: 'file',
        size: 3,
        version: h.version('file-v1'),
      },
    ]);
    expect(h.readVersionedDirectory).toHaveBeenCalledWith(`${ROOT}/src`);

    await expect(h.controller.files.readdir('/')).resolves.toEqual([
      { path: '/main.ts', kind: 'file', size: 3, version: h.version('file-v1') },
    ]);
    expect(h.readVersionedDirectory).toHaveBeenCalledWith(ROOT);

    await expect(h.controller.files.readdir('/node_modules/pkg')).resolves.toEqual([
      {
        path: '/node_modules/pkg/main.ts',
        kind: 'file',
        size: 3,
        version: h.version('file-v1'),
      },
    ]);
    expect(h.readVersionedDirectory).toHaveBeenCalledWith(`${ROOT}/node_modules/pkg`);
  });

  it('publishes the current source tree synchronously and isolates subscriber faults', () => {
    const h = harness();
    const first = vi.fn(() => {
      throw new Error('host listener failed');
    });
    const sibling = vi.fn();

    const unsubscribeFirst = h.controller.files.subscribe(first);
    const unsubscribeSibling = h.controller.files.subscribe(sibling);
    expect(first).toHaveBeenCalledTimes(1);
    expect(sibling).toHaveBeenCalledTimes(1);

    expect(() =>
      h.snapshots.update(
        frame(2, [
          { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
          {
            path: `${ROOT}/src/main.ts`,
            kind: 'file',
            version: 'file-v2',
            bytes: encoder.encode('new'),
          },
        ]),
      ),
    ).not.toThrow();
    expect(first).toHaveBeenCalledTimes(2);
    expect(sibling).toHaveBeenCalledTimes(2);
    expectNoOwnerInternals(sibling.mock.calls[1]?.[0]);

    unsubscribeFirst();
    unsubscribeSibling();
    h.snapshots.update(
      frame(3, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v3' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v3',
          bytes: encoder.encode('third'),
        },
      ]),
    );
    expect(first).toHaveBeenCalledTimes(2);
    expect(sibling).toHaveBeenCalledTimes(2);
  });

  it('uses exact source and target CAS, then waits for rename reflection and durability', async () => {
    const h = harness();
    h.setApply(async (request) => ({
      operationId: request.operationId,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      versions: [
        { path: `${ROOT}/src/main.ts`, version: null },
        { path: `${ROOT}/src/renamed.ts`, version: 'file-v2' },
      ],
    }));

    const renaming = h.controller.files.rename('/src/main.ts', '/src/renamed.ts', {
      expectedSourceVersion: h.version('file-v1'),
      expectedTargetVersion: null,
    });
    expect(h.applyHostCommit).toHaveBeenCalledTimes(1);
    expect(h.applyHostCommit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'rename',
      sourcePath: `${ROOT}/src/main.ts`,
      targetPath: `${ROOT}/src/renamed.ts`,
      expectedSourceVersion: 'file-v1',
      expectedTargetVersion: null,
    });
    await nextTurn();
    expect(await isPending(renaming)).toBe(true);

    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/renamed.ts`,
          kind: 'file',
          version: 'file-v2',
          bytes: encoder.encode('old'),
        },
      ]),
    );
    await nextTurn();
    expect(h.durabilityBarrier).toHaveBeenCalledWith(2);
    expect(await isPending(renaming)).toBe(true);
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(renaming).resolves.toEqual({
      path: '/src/renamed.ts',
      version: h.version('file-v2'),
    });
  });

  it('replaces an existing rename target only with its exact non-null version', async () => {
    const h = harness();
    h.setApply(async (request) => ({
      operationId: request.operationId,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      versions: [
        { path: `${ROOT}/src/main.ts`, version: null },
        { path: `${ROOT}/src/target.ts`, version: 'target-v2' },
      ],
    }));

    const renaming = h.controller.files.rename('/src/main.ts', '/src/target.ts', {
      expectedSourceVersion: h.version('file-v1'),
      expectedTargetVersion: h.version('target-v1'),
    });
    expect(h.applyHostCommit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'rename',
      sourcePath: `${ROOT}/src/main.ts`,
      targetPath: `${ROOT}/src/target.ts`,
      expectedSourceVersion: 'file-v1',
      expectedTargetVersion: 'target-v1',
    });
    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/target.ts`,
          kind: 'file',
          version: 'target-v2',
          bytes: encoder.encode('old'),
        },
      ]),
    );
    await nextTurn();
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(renaming).resolves.toEqual({
      path: '/src/target.ts',
      version: h.version('target-v2'),
    });
  });

  it('uses exact remove CAS and resolves only after absence is reflected and durable', async () => {
    const h = harness();
    h.setApply(async (request) => ({
      operationId: request.operationId,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      versions: [{ path: `${ROOT}/src/main.ts`, version: null }],
    }));

    const removing = h.controller.files.remove('/src/main.ts', {
      expectedVersion: h.version('file-v1'),
      recursive: true,
    });
    expect(h.applyHostCommit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'remove',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v1',
      recursive: true,
    });
    await nextTurn();
    expect(await isPending(removing)).toBe(true);

    h.snapshots.update(frame(2, [{ path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' }]));
    await nextTurn();
    expect(h.durabilityBarrier).toHaveBeenCalledWith(2);
    expect(await isPending(removing)).toBe(true);
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(removing).resolves.toBeUndefined();
  });

  it('fences every new operation on close without rewriting an already admitted outcome', async () => {
    const h = harness();
    const listener = vi.fn();
    const unsubscribe = h.controller.files.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const writing = h.controller.files.writeFile('/src/main.ts', encoder.encode('new'), {
      expectedVersion: h.version('file-v1'),
    });
    h.controller.close();

    for (const operation of [
      () => h.controller.files.readFile('/src/main.ts'),
      () => h.controller.files.readdir('/src'),
      () =>
        h.controller.files.writeFile('/src/late.ts', encoder.encode('late'), {
          expectedVersion: null,
        }),
      () => h.controller.files.mkdir('/late', { expectedVersion: null }),
      () =>
        h.controller.files.rename('/src/main.ts', '/src/late.ts', {
          expectedSourceVersion: h.version('file-v1'),
          expectedTargetVersion: null,
        }),
      () =>
        h.controller.files.remove('/src/main.ts', {
          expectedVersion: h.version('file-v1'),
        }),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(ClosedHandleError);
    }
    expect(() => h.controller.files.snapshot()).toThrow(ClosedHandleError);
    expect(() => h.controller.files.subscribe(() => {})).toThrow(ClosedHandleError);

    h.snapshots.update(
      frame(2, [
        { path: `${ROOT}/src`, kind: 'dir', version: 'dir-v2' },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          version: 'file-v2',
          bytes: encoder.encode('new'),
        },
      ]),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => unsubscribe()).not.toThrow();
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
      durability: 'durable',
    });
    await expect(writing).resolves.toEqual({
      path: '/src/main.ts',
      version: h.version('file-v2'),
    });
  });
});
