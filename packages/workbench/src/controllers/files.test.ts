import { describe, expect, it, vi } from 'vitest';
import type { VfsSnapshotEntry, VfsSnapshotFrame } from '../glue/vfs-snapshot-port.ts';
import type { VfsWriteFrame } from '../glue/vfs-write-port.ts';
import { type FilesOwnerPort, createFilesController } from './files.ts';

function frame(entries: readonly VfsSnapshotEntry[]): VfsSnapshotFrame {
  return {
    type: 'snapshot',
    root: '/workspace',
    entries,
    nodeModulesPresent: false,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('files controller', () => {
  it('applies owner snapshots, lists sorted children, and watches revisions', () => {
    let onSnapshot: ((next: VfsSnapshotFrame) => void) | null = null;
    const owner: FilesOwnerPort = {
      writeFrameAcked: async () => {},
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
      subscribeSnapshots: (listener) => {
        onSnapshot = listener;
        return () => {
          onSnapshot = null;
        };
      },
    });
    const revisions: number[] = [];
    controller.watch((snapshot) => revisions.push(snapshot.revision));

    expect(onSnapshot).not.toBeNull();
    const deliver = onSnapshot as unknown as (next: VfsSnapshotFrame) => void;
    deliver(
      frame([
        { path: '/workspace/z.txt', kind: 'file', size: 1, content: new Uint8Array([1]) },
        { path: '/workspace/src', kind: 'dir', size: 0 },
        { path: '/workspace/a.txt', kind: 'file', size: 1, content: new Uint8Array([2]) },
      ]),
    );

    expect(controller.list()).toEqual([
      { path: '/workspace/src', name: 'src', kind: 'dir' },
      { path: '/workspace/a.txt', name: 'a.txt', kind: 'file' },
      { path: '/workspace/z.txt', name: 'z.txt', kind: 'file' },
    ]);
    expect(controller.snapshot()).toMatchObject({ ready: true, revision: 1, error: null });
    expect(revisions).toEqual([0, 1]);
    controller.dispose();
    expect(onSnapshot).toBeNull();
  });

  it('does not resolve a mutation until owner ack and a later matching snapshot', async () => {
    const ack = deferred();
    const frames: VfsWriteFrame[] = [];
    const owner: FilesOwnerPort = {
      writeFrameAcked: async (next) => {
        frames.push(next);
        await ack.promise;
      },
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
    });
    controller.applySnapshot(frame([{ path: '/workspace/src', kind: 'dir', size: 0 }]));

    let settled = false;
    const mutation = controller.createFile('/workspace/src/main.ts', 'export {};').then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(frames[0]).toMatchObject({
      type: 'write',
      path: '/workspace/src/main.ts',
      recursive: false,
      ifAbsent: true,
    });
    ack.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.applySnapshot(frame([{ path: '/workspace/src', kind: 'dir', size: 0 }]));
    await Promise.resolve();
    expect(settled).toBe(false);

    const bytes = new TextEncoder().encode('export {};');
    controller.applySnapshot(
      frame([
        { path: '/workspace/src', kind: 'dir', size: 0 },
        { path: '/workspace/src/main.ts', kind: 'file', size: bytes.length, content: bytes },
      ]),
    );
    await mutation;
    expect(controller.snapshot()).toMatchObject({
      pendingMutations: 0,
      durable: true,
      error: null,
    });
    controller.dispose();
  });

  it('renames and deletes only after their reflected owner snapshots', async () => {
    const sent: VfsWriteFrame[] = [];
    const owner: FilesOwnerPort = {
      writeFrameAcked: async (next) => {
        sent.push(next);
      },
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
    });
    const oldEntry: VfsSnapshotEntry = {
      path: '/workspace/old.txt',
      kind: 'file',
      size: 1,
      content: new Uint8Array([1]),
    };
    controller.applySnapshot(frame([oldEntry]));

    const renamed = controller.rename('/workspace/old.txt', '/workspace/new.txt');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const newEntry = { ...oldEntry, path: '/workspace/new.txt' };
    controller.applySnapshot(frame([newEntry]));
    await renamed;
    expect(sent[0]).toEqual({
      type: 'rename',
      from: '/workspace/old.txt',
      to: '/workspace/new.txt',
    });

    const deleted = controller.deletePath('/workspace/new.txt');
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    controller.applySnapshot(frame([]));
    await deleted;
    expect(sent[1]).toEqual({
      type: 'rm',
      path: '/workspace/new.txt',
      recursive: true,
      force: false,
    });
    controller.dispose();
  });

  it('surfaces owner rejection and rejects pending work immediately on dispose', async () => {
    const hanging = deferred();
    let call = 0;
    const owner: FilesOwnerPort = {
      writeFrameAcked: async () => {
        call += 1;
        if (call === 1) throw new Error('rename collision in owner');
        await hanging.promise;
      },
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
    });
    controller.applySnapshot(
      frame([{ path: '/workspace/a.txt', kind: 'file', size: 0, content: new Uint8Array() }]),
    );

    await expect(controller.rename('/workspace/a.txt', '/workspace/b.txt')).rejects.toThrow(
      'rename collision in owner',
    );
    expect(controller.snapshot()).toMatchObject({
      pendingMutations: 0,
      error: 'rename collision in owner',
    });

    const pending = controller.createDirectory('/workspace/new-dir');
    await vi.waitFor(() => expect(call).toBe(2));
    controller.dispose();
    controller.dispose();
    await expect(pending).rejects.toThrow('files controller disposed');
    expect(() => controller.snapshot()).toThrow('files controller disposed');
  });

  it('cancels pending mutations even when the external snapshot unsubscribe throws', async () => {
    const ack = deferred();
    const owner: FilesOwnerPort = {
      writeFrameAcked: () => ack.promise,
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
      subscribeSnapshots: () => () => {
        throw new Error('external snapshot unsubscribe failed');
      },
      reflectTimeoutMs: 20,
    });
    controller.applySnapshot(frame([{ path: '/workspace/src', kind: 'dir', size: 0 }]));
    const mutation = controller.createDirectory('/workspace/src/pending');
    void mutation.catch(() => {});

    let disposeError: unknown;
    try {
      controller.dispose();
    } catch (error) {
      disposeError = error;
    }
    await expect(mutation).rejects.toThrow('files controller disposed');
    expect(disposeError).toMatchObject({
      name: 'AggregateError',
      message: 'files controller dispose failed',
      errors: [expect.objectContaining({ message: 'external snapshot unsubscribe failed' })],
    });

    ack.resolve();
  });

  it('preserves the snapshot request failure ahead of rollback unsubscribe errors', () => {
    const requestError = new Error('snapshot request failed');
    const unsubscribeError = new Error('snapshot unsubscribe failed');
    const unsubscribe = vi.fn(() => {
      throw unsubscribeError;
    });
    const owner: FilesOwnerPort = {
      writeFrameAcked: async () => {},
      flushDurable: async () => {},
    };

    let failure: unknown;
    try {
      createFilesController({
        root: '/workspace',
        storageBackend: 'opfs',
        currentOwner: () => owner,
        subscribeSnapshots: () => unsubscribe,
        requestSnapshot: () => {
          throw requestError;
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({
      name: 'AggregateError',
      errors: [requestError, unsubscribeError],
    });
  });

  it('rejects a reflected mutation when the owner durability barrier reports quota failure', async () => {
    let deliver: ((next: VfsSnapshotFrame) => void) | null = null;
    const owner: FilesOwnerPort = {
      writeFrameAcked: async () => {},
      flushDurable: async () => {
        throw new Error('OPFS quota exceeded while flushing');
      },
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'opfs',
      currentOwner: () => owner,
      subscribeSnapshots: (listener) => {
        deliver = listener;
        return () => {};
      },
    });
    controller.applySnapshot(frame([{ path: '/workspace/src', kind: 'dir', size: 0 }]));
    const mutation = controller.createFile('/workspace/src/quota.txt', 'data');
    const bytes = new TextEncoder().encode('data');
    await vi.waitFor(() => expect(deliver).not.toBeNull());
    const push = deliver as unknown as (next: VfsSnapshotFrame) => void;
    push(
      frame([
        { path: '/workspace/src', kind: 'dir', size: 0 },
        {
          path: '/workspace/src/quota.txt',
          kind: 'file',
          size: bytes.length,
          content: bytes,
        },
      ]),
    );

    await expect(mutation).rejects.toThrow('OPFS quota exceeded while flushing');
    expect(controller.snapshot()).toMatchObject({
      pendingMutations: 0,
      durable: false,
      error: 'OPFS quota exceeded while flushing',
    });
    controller.dispose();
  });

  it('keeps successful memory mutations explicitly ephemeral', async () => {
    let deliver: ((next: VfsSnapshotFrame) => void) | null = null;
    const owner: FilesOwnerPort = {
      writeFrameAcked: async () => {},
      flushDurable: async () => {},
    };
    const controller = createFilesController({
      root: '/workspace',
      storageBackend: 'memory',
      currentOwner: () => owner,
      subscribeSnapshots: (listener) => {
        deliver = listener;
        return () => {};
      },
    });
    controller.applySnapshot(frame([{ path: '/workspace/src', kind: 'dir', size: 0 }]));
    const mutation = controller.createFile('/workspace/src/ephemeral.txt', 'memory');
    const bytes = new TextEncoder().encode('memory');
    await vi.waitFor(() => expect(deliver).not.toBeNull());
    const push = deliver as unknown as (next: VfsSnapshotFrame) => void;
    push(
      frame([
        { path: '/workspace/src', kind: 'dir', size: 0 },
        {
          path: '/workspace/src/ephemeral.txt',
          kind: 'file',
          size: bytes.length,
          content: bytes,
        },
      ]),
    );
    await mutation;
    expect(controller.snapshot()).toMatchObject({ durable: false, error: null });
    controller.dispose();
  });
});
