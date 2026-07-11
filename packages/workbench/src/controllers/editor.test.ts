import { describe, expect, it, vi } from 'vitest';
import type { VfsWriteFrame } from '../glue/vfs-write-port.ts';
import { type EditorOwnerPort, createEditorController } from './editor.ts';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('editor controller', () => {
  it('opens through the owner read port and exposes every state transition', async () => {
    const states: string[] = [];
    const owner: EditorOwnerPort = {
      readFileBytes: vi.fn(async () => new TextEncoder().encode('const n = 1;')),
      writeFrameAcked: vi.fn(async () => {}),
      flushDurable: vi.fn(async () => {}),
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'opfs',
    });
    controller.subscribe((snapshot) => states.push(snapshot.status));

    await controller.open('/workspace/src/main.ts');
    expect(owner.readFileBytes).toHaveBeenCalledWith('/workspace/src/main.ts');
    expect(controller.snapshot()).toEqual({
      status: 'ready',
      path: '/workspace/src/main.ts',
      text: 'const n = 1;',
      dirty: false,
      durable: false,
      error: null,
    });
    expect(states).toEqual(['idle', 'opening', 'ready']);
    controller.dispose();
  });

  it('saves applied bytes first, then claims durability only after the flush ack', async () => {
    const writeAck = deferred();
    const flushAck = deferred();
    const frames: VfsWriteFrame[] = [];
    const owner: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('old'),
      writeFrameAcked: async (frame) => {
        frames.push(frame);
        await writeAck.promise;
      },
      flushDurable: () => flushAck.promise,
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'opfs',
    });
    await controller.open('/workspace/main.js');
    controller.edit('new source');
    expect(controller.snapshot()).toMatchObject({ dirty: true, durable: false });

    const saving = controller.save();
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(frames[0]).toMatchObject({
      type: 'write',
      path: '/workspace/main.js',
      data: new TextEncoder().encode('new source'),
    });
    expect(controller.snapshot()).toMatchObject({ status: 'saving', dirty: true, durable: false });

    writeAck.resolve();
    await vi.waitFor(() =>
      expect(controller.snapshot()).toMatchObject({ status: 'saving', dirty: false }),
    );
    expect(controller.snapshot().durable).toBe(false);
    flushAck.resolve();
    await saving;
    expect(controller.snapshot()).toMatchObject({ status: 'ready', dirty: false, durable: true });
    controller.dispose();
  });

  it('reports a failed durability barrier and keeps the document dirty', async () => {
    const owner: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('old'),
      writeFrameAcked: async () => {},
      flushDurable: async () => {
        throw new Error('OPFS quota exhausted');
      },
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'opfs',
    });
    await controller.open('/workspace/main.js');
    controller.edit('new');

    await expect(controller.save()).rejects.toThrow('OPFS quota exhausted');
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      dirty: true,
      durable: false,
      error: 'OPFS quota exhausted',
    });
    controller.dispose();
  });

  it('flushes the owner captured for the save when the active owner switches after write ack', async () => {
    let active: EditorOwnerPort;
    const replacement: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('replacement'),
      writeFrameAcked: vi.fn(async () => {}),
      flushDurable: vi.fn(async () => {}),
    };
    const first: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('old'),
      writeFrameAcked: vi.fn(async () => {
        active = replacement;
      }),
      flushDurable: vi.fn(async () => {}),
    };
    active = first;
    const controller = createEditorController({
      currentOwner: () => active,
      storageBackend: 'opfs',
    });
    await controller.open('/workspace/main.js');
    controller.edit('new');

    await controller.save();

    expect(first.writeFrameAcked).toHaveBeenCalledOnce();
    expect(first.flushDurable).toHaveBeenCalledOnce();
    expect(replacement.flushDurable).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('never marks edits made during an in-flight flush durable', async () => {
    const flush = deferred();
    const owner: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('v0'),
      writeFrameAcked: async () => {},
      flushDurable: () => flush.promise,
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'opfs',
    });
    await controller.open('/workspace/main.js');
    controller.edit('v1');
    const saving = controller.save();
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('saving'));
    controller.edit('v2');
    flush.resolve();
    await saving;

    expect(controller.snapshot()).toMatchObject({
      status: 'ready',
      text: 'v2',
      dirty: true,
      durable: false,
    });
    controller.dispose();
  });

  it('dispose rejects in-flight work and every later operation is loud', async () => {
    const read = deferred<Uint8Array>();
    const owner: EditorOwnerPort = {
      readFileBytes: () => read.promise,
      writeFrameAcked: async () => {},
      flushDurable: async () => {},
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'opfs',
    });
    const opening = controller.open('/workspace/hung.ts');
    controller.dispose();
    controller.dispose();

    await expect(opening).rejects.toThrow('editor controller disposed');
    expect(() => controller.snapshot()).toThrow('editor controller disposed');
    expect(() => controller.edit('late')).toThrow('editor controller disposed');
  });

  it('flushes memory state without calling it durable', async () => {
    const owner: EditorOwnerPort = {
      readFileBytes: async () => new TextEncoder().encode('old'),
      writeFrameAcked: async () => {},
      flushDurable: vi.fn(async () => {}),
    };
    const controller = createEditorController({
      currentOwner: () => owner,
      storageBackend: 'memory',
    });
    await controller.open('/workspace/main.js');
    controller.edit('ephemeral');
    await controller.save();
    expect(owner.flushDurable).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({ dirty: false, durable: false, error: null });
    controller.dispose();
  });
});
