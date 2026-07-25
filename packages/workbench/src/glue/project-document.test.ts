import { describe, expect, it } from 'vitest';
import type { HostCommitRequest } from './owner-vfs-protocol.ts';
import {
  type ProjectDocumentCommitter,
  type ProjectDocumentReadSource,
  openProjectDocument,
} from './project-document.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function receipt(request: HostCommitRequest, version: string) {
  return {
    operationId: request.operationId,
    ownerEpoch: 'owner-a',
    treeRevision: 2,
    versions: [{ path: request.kind === 'rename' ? request.targetPath : request.path, version }],
    durability: 'durable' as const,
  };
}

describe('ProjectDocument', () => {
  it('opens bytes and version atomically, then saves with the captured version', async () => {
    let reads = 0;
    const operations: HostCommitRequest[] = [];
    const source: ProjectDocumentReadSource = {
      async readVersionedFile(path) {
        reads += 1;
        return {
          path,
          kind: 'file',
          size: 3,
          content: encoder.encode('old'),
          version: 'v1',
        };
      },
    };
    const committer: ProjectDocumentCommitter = {
      commit(operation) {
        const request = {
          ...operation,
          operationId: `test:${operations.length + 1}`,
        } as HostCommitRequest;
        operations.push(request);
        return Promise.resolve(receipt(request, 'v2'));
      },
    };

    const document = await openProjectDocument('/src/main.ts', source, committer);
    expect(reads).toBe(1);
    expect(document.snapshot()).toMatchObject({
      path: '/src/main.ts',
      version: 'v1',
      dirty: false,
      conflict: null,
    });
    expect(decoder.decode(document.snapshot().bytes)).toBe('old');

    document.replace('new');
    expect(document.snapshot().dirty).toBe(true);
    await expect(document.save()).resolves.toBeUndefined();

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: 'write',
      path: '/src/main.ts',
      expectedVersion: 'v1',
    });
    if (operations[0]?.kind === 'write') {
      expect(decoder.decode(operations[0].data)).toBe('new');
    }
    expect(document.snapshot()).toMatchObject({ version: 'v2', dirty: false });
  });

  it('keeps an edit made during save dirty while advancing the committed version', async () => {
    const pending = deferred<ReturnType<typeof receipt>>();
    let request!: HostCommitRequest;
    const document = await openProjectDocument(
      '/note.txt',
      {
        async readVersionedFile(path) {
          return {
            path,
            kind: 'file',
            size: 4,
            content: encoder.encode('base'),
            version: 'v1',
          };
        },
      },
      {
        commit(operation) {
          request = { ...operation, operationId: 'test:1' } as HostCommitRequest;
          return pending.promise;
        },
      },
    );

    document.replace('first');
    const saving = document.save();
    document.replace('second');
    pending.resolve(receipt(request, 'v2'));

    await expect(saving).resolves.toBeUndefined();
    const state = document.snapshot();
    expect(state.version).toBe('v2');
    expect(state.dirty).toBe(true);
    expect(decoder.decode(state.bytes)).toBe('second');
  });
});
