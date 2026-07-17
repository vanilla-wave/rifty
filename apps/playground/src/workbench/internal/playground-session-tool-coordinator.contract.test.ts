import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommitOperation, OwnerVfsSnapshotEntry } from '../../glue/owner-vfs-protocol.ts';
import type { VfsCommitReceipt } from '../../glue/vfs-commit-coordinator.ts';
import { DirtyProjectDocumentError } from '../errors.ts';
import { createProjectDocumentsController } from '../project-documents.ts';
import { createProjectFileVersionBoundary } from '../project-file-boundary.ts';
import {
  type PlaygroundArchiveBackend,
  type PlaygroundScmArchiveTools,
  type PlaygroundScmBackend,
  createPlaygroundScmArchiveTools,
} from './playground-session-tool-coordinator.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const OWNER_EPOCH = 'playground-session-tools-owner';
const SOURCE = '/src/main.ts';
const SECONDARY = '/src/secondary.ts';
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

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(pending)])) === pending;
}

function write(fs: MemoryFsSync, publicPath: string, text: string): void {
  const path = `${PROJECT_ROOT}${publicPath}`;
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, encoder.encode(text));
}

type VersionedFile = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }> & {
  readonly ownerEpoch: string;
  readonly treeRevision: number;
};

function documentsHarness() {
  const fs = new MemoryFsSync();
  write(fs, SOURCE, 'original');
  write(fs, SECONDARY, 'secondary');
  const versions = createProjectFileVersionBoundary('playground-session-tools');
  let treeRevision = 1;
  const ownerVersions = new Map<string, string>([
    [`${PROJECT_ROOT}${SOURCE}`, 'file-v1'],
    [`${PROJECT_ROOT}${SECONDARY}`, 'file-v1-secondary'],
  ]);
  const readVersionedFile = vi.fn(async (path: string): Promise<VersionedFile> => {
    const content = fs.readFileBytesSync(path);
    return {
      path,
      kind: 'file',
      size: content.byteLength,
      content,
      version: ownerVersions.get(path) ?? `file-v${String(treeRevision)}`,
      ownerEpoch: OWNER_EPOCH,
      treeRevision,
    };
  });
  const directCommit = async (operation: HostCommitOperation): Promise<VfsCommitReceipt> => {
    if (operation.kind !== 'write') throw new Error(`Unexpected document commit ${operation.kind}`);
    fs.writeFileSync(operation.path, operation.data);
    treeRevision += 1;
    const version = `file-v${String(treeRevision)}`;
    ownerVersions.set(operation.path, version);
    return {
      operationId: `document-save-${String(treeRevision)}`,
      ownerEpoch: OWNER_EPOCH,
      treeRevision,
      versions: [{ path: operation.path, version }],
      durability: 'durable',
    };
  };
  let commitImpl = directCommit;
  const commit = vi.fn((operation: HostCommitOperation) => commitImpl(operation));
  const controller = createProjectDocumentsController({
    projectRoot: PROJECT_ROOT,
    versions,
    readVersionedFile,
    committer: { commit },
  });
  return {
    fs,
    controller,
    commit,
    revision() {
      treeRevision += 1;
      return { ownerEpoch: OWNER_EPOCH, treeRevision };
    },
    receipt(path = `${PROJECT_ROOT}${SOURCE}`): VfsCommitReceipt {
      treeRevision += 1;
      const version = `file-v${String(treeRevision)}`;
      ownerVersions.set(path, version);
      return {
        operationId: `document-save-${String(treeRevision)}`,
        ownerEpoch: OWNER_EPOCH,
        treeRevision,
        versions: [{ path, version }],
        durability: 'durable',
      };
    },
    setCommit(next: (operation: HostCommitOperation) => Promise<VfsCommitReceipt>) {
      commitImpl = next;
    },
  };
}

const scmSnapshot = Object.freeze({
  branch: 'main',
  history: Object.freeze([]),
  changes: Object.freeze([]),
});
const change = Object.freeze({ path: SOURCE, code: ' M', area: 'working' as const });
const emptyArchive = JSON.stringify({ version: 1, root: '/', files: [] });

function toolHarness() {
  const documents = documentsHarness();
  const scm = {
    snapshot: vi.fn(() => scmSnapshot),
    subscribe: vi.fn((listener: (snapshot: typeof scmSnapshot) => void) => {
      listener(scmSnapshot);
      return () => {};
    }),
    refresh: vi.fn(async () => scmSnapshot),
    diff: vi.fn(async () => ({
      original: { source: 'head' as const, bytes: encoder.encode('original') },
      modified: { source: 'working' as const, bytes: encoder.encode('working') },
    })),
    stage: vi.fn(async () => {}),
    unstage: vi.fn(async () => {}),
    discard: vi.fn(async (path: string) => {
      write(documents.fs, path, 'restored from index');
      return { revision: documents.revision() };
    }),
    commit: vi.fn(async () => 'commit-oid'),
  } satisfies PlaygroundScmBackend;
  const archive = {
    export: vi.fn(async () => emptyArchive),
    import: vi.fn(async () => {
      documents.fs.rmSync(PROJECT_ROOT, { recursive: true, force: true });
      write(documents.fs, SOURCE, 'imported');
      write(documents.fs, SECONDARY, 'imported secondary');
      return { revision: documents.revision() };
    }),
  } satisfies PlaygroundArchiveBackend;
  const tools = createPlaygroundScmArchiveTools({
    documents: documents.controller,
    scm,
    archive,
  });
  return { ...documents, scm, archive, tools };
}

interface ToolOperationCase {
  readonly name: string;
  readonly scope: 'path' | 'project';
  readonly invoke: (tools: PlaygroundScmArchiveTools) => Promise<unknown>;
  readonly backendCalls: (harness: ReturnType<typeof toolHarness>) => number;
}

function ownerByteOperationCases(): readonly ToolOperationCase[] {
  return [
    {
      name: 'diff',
      scope: 'path',
      invoke: (tools) => tools.scm.diff(change),
      backendCalls: (h) => h.scm.diff.mock.calls.length,
    },
    {
      name: 'stage',
      scope: 'path',
      invoke: (tools) => tools.scm.stage(SOURCE),
      backendCalls: (h) => h.scm.stage.mock.calls.length,
    },
    {
      name: 'unstage',
      scope: 'path',
      invoke: (tools) => tools.scm.unstage(SOURCE),
      backendCalls: (h) => h.scm.unstage.mock.calls.length,
    },
    {
      name: 'discard',
      scope: 'path',
      invoke: (tools) => tools.scm.discard(SOURCE),
      backendCalls: (h) => h.scm.discard.mock.calls.length,
    },
    {
      name: 'commit',
      scope: 'project',
      invoke: (tools) => tools.scm.commit('after save'),
      backendCalls: (h) => h.scm.commit.mock.calls.length,
    },
    {
      name: 'archive export',
      scope: 'project',
      invoke: (tools) => tools.archive.export(),
      backendCalls: (h) => h.archive.export.mock.calls.length,
    },
    {
      name: 'archive import',
      scope: 'project',
      invoke: (tools) => tools.archive.import(emptyArchive),
      backendCalls: (h) => h.archive.import.mock.calls.length,
    },
  ];
}

describe('Documents to SCM/archive admission', () => {
  it('rejects every owner-byte read or mutation while relevant Documents are dirty', async () => {
    const h = toolHarness();
    const document = await h.controller.documents.open(SOURCE);
    document.replace('editor-only bytes');

    await expect(h.tools.scm.diff(change)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(h.tools.scm.stage(SOURCE)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(h.tools.scm.unstage(SOURCE)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(h.tools.scm.discard(SOURCE)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(h.tools.scm.commit('must not commit')).rejects.toBeInstanceOf(
      DirtyProjectDocumentError,
    );
    await expect(h.tools.archive.export()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(h.tools.archive.import(emptyArchive)).rejects.toBeInstanceOf(
      DirtyProjectDocumentError,
    );

    expect(h.scm.diff).not.toHaveBeenCalled();
    expect(h.scm.stage).not.toHaveBeenCalled();
    expect(h.scm.unstage).not.toHaveBeenCalled();
    expect(h.scm.discard).not.toHaveBeenCalled();
    expect(h.scm.commit).not.toHaveBeenCalled();
    expect(h.archive.export).not.toHaveBeenCalled();
    expect(h.archive.import).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect(document.snapshot()).toMatchObject({
      bytes: encoder.encode('editor-only bytes'),
      dirty: true,
      staleReason: null,
      closed: false,
    });
  });

  it('scopes path operations to their target but gates commit and archive over the whole project', async () => {
    const h = toolHarness();
    const dirty = await h.controller.documents.open(SECONDARY);
    dirty.replace('unrelated dirty editor');

    for (const testCase of ownerByteOperationCases()) {
      if (testCase.scope === 'path') await testCase.invoke(h.tools);
      else await expect(testCase.invoke(h.tools)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    }

    expect(h.scm.diff).toHaveBeenCalledTimes(1);
    expect(h.scm.stage).toHaveBeenCalledTimes(1);
    expect(h.scm.unstage).toHaveBeenCalledTimes(1);
    expect(h.scm.discard).toHaveBeenCalledTimes(1);
    expect(h.scm.commit).not.toHaveBeenCalled();
    expect(h.archive.export).not.toHaveBeenCalled();
    expect(h.archive.import).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('awaits one already-admitted save before every sibling owner-byte operation', async () => {
    for (const testCase of ownerByteOperationCases()) {
      const h = toolHarness();
      const saving = deferred<VfsCommitReceipt>();
      h.setCommit(() => saving.promise);
      const document = await h.controller.documents.open(SOURCE);
      document.replace(`save before ${testCase.name}`);
      const admittedSave = document.save();
      const operation = testCase.invoke(h.tools);

      expect(await isPending(operation)).toBe(true);
      expect(testCase.backendCalls(h)).toBe(0);
      saving.resolve(h.receipt());
      await expect(admittedSave).resolves.toBeUndefined();
      await operation;
      expect(testCase.backendCalls(h)).toBe(1);
      expect(document.snapshot().dirty).toBe(false);
    }
  });

  it('propagates an admitted save failure and never falls through to SCM or archive', async () => {
    for (const testCase of ownerByteOperationCases()) {
      const h = toolHarness();
      const saving = deferred<VfsCommitReceipt>();
      h.setCommit(() => saving.promise);
      const document = await h.controller.documents.open(SOURCE);
      document.replace(`failed save before ${testCase.name}`);
      const admittedSave = document.save();
      const operation = testCase.invoke(h.tools);
      const ownerFailure = new Error(`owner rejected save before ${testCase.name}`);

      saving.reject(ownerFailure);
      const saveFailure = await admittedSave.catch((error: unknown) => error);
      await expect(operation).rejects.toBe(saveFailure);
      expect(testCase.backendCalls(h)).toBe(0);
      expect(document.snapshot()).toMatchObject({ dirty: true, staleReason: null, closed: false });
    }
  });

  it('rechecks dirty state after an admitted save before every sibling admission', async () => {
    for (const testCase of ownerByteOperationCases()) {
      const h = toolHarness();
      const saving = deferred<VfsCommitReceipt>();
      h.setCommit(() => saving.promise);
      const document = await h.controller.documents.open(SOURCE);
      document.replace(`first edit admitted before ${testCase.name}`);
      const admittedSave = document.save();
      const operation = testCase.invoke(h.tools);

      expect(await isPending(operation)).toBe(true);
      document.replace(`second edit while ${testCase.name} waits`);
      saving.resolve(h.receipt());

      await expect(admittedSave).resolves.toBeUndefined();
      await expect(operation).rejects.toBeInstanceOf(DirtyProjectDocumentError);
      expect(testCase.backendCalls(h)).toBe(0);
      expect(document.snapshot()).toMatchObject({
        bytes: encoder.encode(`second edit while ${testCase.name} waits`),
        dirty: true,
        staleReason: null,
        closed: false,
      });
    }
  });
});

describe('Documents invalidation after destructive session tools', () => {
  it('requires explicit dirty discard, then stales the exact restored path before resolving', async () => {
    const h = toolHarness();
    const dirty = await h.controller.documents.open(SOURCE);
    dirty.replace('local editor change');

    await expect(h.tools.scm.discard(SOURCE)).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    expect(h.scm.discard).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();

    await dirty.close({ dirty: 'discard' });
    const restored = await h.controller.documents.open(SOURCE);
    await h.tools.scm.discard(SOURCE);

    expect(h.scm.discard).toHaveBeenCalledTimes(1);
    expect(h.scm.discard).toHaveBeenCalledWith(SOURCE);
    expect(restored.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });
    expect(() => restored.replace('late')).toThrow();
  });

  it('requires explicit dirty admission, then invalidates every document after archive import', async () => {
    const h = toolHarness();
    const dirty = await h.controller.documents.open(SOURCE);
    dirty.replace('local editor change');

    await expect(h.tools.archive.import(emptyArchive)).rejects.toBeInstanceOf(
      DirtyProjectDocumentError,
    );
    expect(h.archive.import).not.toHaveBeenCalled();

    await dirty.close({ dirty: 'discard' });
    const source = await h.controller.documents.open(SOURCE);
    const secondary = await h.controller.documents.open(SECONDARY);
    await h.tools.archive.import(emptyArchive);

    expect(h.archive.import).toHaveBeenCalledTimes(1);
    expect(h.archive.import).toHaveBeenCalledWith(emptyArchive);
    expect(source.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });
    expect(secondary.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });
    expect(() => source.replace('late')).toThrow();
    expect(() => secondary.replace('late')).toThrow();
  });
});
