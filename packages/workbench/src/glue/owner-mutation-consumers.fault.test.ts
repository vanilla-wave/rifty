import { describe, expect, it, vi } from 'vitest';
import { type FilesOwnerPort, createFilesController } from '../controllers/files.ts';
import { OwnerRpcFs, type OwnerRpcFsWriter } from './owner-rpc-fs.ts';
import { SnapshotFs } from './snapshot-fs.ts';
import type { VfsSnapshotFrame } from './vfs-snapshot-port.ts';
import type { VfsWriteFrame } from './vfs-write-port.ts';

const encoder = new TextEncoder();
const TARGET = '/workspace/src/main.ts';
const DATA = encoder.encode('export {};');

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(matched: boolean): VfsSnapshotFrame {
  return {
    type: 'snapshot',
    root: '/workspace',
    entries: [
      { path: '/workspace/src', kind: 'dir', size: 0 },
      ...(matched
        ? [{ path: TARGET, kind: 'file' as const, size: DATA.byteLength, content: DATA }]
        : []),
    ],
    nodeModulesPresent: false,
  };
}

interface MutationHarness {
  readonly events: string[];
  readonly frames: VfsWriteFrame[];
  readonly ack: Deferred;
  readonly flush: Deferred;
  mutate(): Promise<void>;
  publish(matched: boolean): void;
  publishOnNextOwnerRead(): void;
  dispose(): void;
}

function mutationPort(
  events: string[],
  frames: VfsWriteFrame[],
  ack: Deferred,
  flush: Deferred,
): FilesOwnerPort & OwnerRpcFsWriter {
  return {
    writeFrameAcked(frame) {
      events.push('send');
      frames.push(frame);
      return ack.promise.then(() => {
        events.push('ack');
      });
    },
    flushDurable() {
      events.push('flush:start');
      return flush.promise.then(() => {
        events.push('flush:done');
      });
    },
  };
}

function filesHarness(timeoutMs = 250): MutationHarness {
  const events: string[] = [];
  const frames: VfsWriteFrame[] = [];
  const ack = deferred();
  const flush = deferred();
  const owner = mutationPort(events, frames, ack, flush);
  let publishOnRead = false;
  const controller = createFilesController({
    root: '/workspace',
    storageBackend: 'opfs',
    currentOwner: () => {
      if (publishOnRead) {
        publishOnRead = false;
        controller.applySnapshot(snapshot(true));
      }
      return owner;
    },
    reflectTimeoutMs: timeoutMs,
  });
  controller.applySnapshot(snapshot(false));
  return {
    events,
    frames,
    ack,
    flush,
    mutate: () => controller.createFile(TARGET, DATA),
    publish: (matched) => controller.applySnapshot(snapshot(matched)),
    publishOnNextOwnerRead: () => {
      publishOnRead = true;
    },
    dispose: () => controller.dispose(),
  };
}

function ownerRpcHarness(timeoutMs = 250): MutationHarness {
  const events: string[] = [];
  const frames: VfsWriteFrame[] = [];
  const ack = deferred();
  const flush = deferred();
  const owner = mutationPort(events, frames, ack, flush);
  const view = new SnapshotFs('/workspace');
  view.update(snapshot(false));
  let publishOnRead = false;
  const rpc = new OwnerRpcFs(
    view,
    () => {
      if (publishOnRead) {
        publishOnRead = false;
        view.update(snapshot(true));
      }
      return owner;
    },
    { timeoutMs },
  );
  return {
    events,
    frames,
    ack,
    flush,
    mutate: () => rpc.writeFile(TARGET, DATA),
    publish: (matched) => view.update(snapshot(matched)),
    publishOnNextOwnerRead: () => {
      publishOnRead = true;
    },
    dispose: () => {
      const dispose: unknown = Reflect.get(rpc, 'dispose');
      if (typeof dispose !== 'function') throw new Error('OwnerRpcFs.dispose is unavailable');
      Reflect.apply(dispose, rpc, []);
    },
  };
}

const consumers = [
  ['FilesController', filesHarness],
  ['OwnerRpcFs', ownerRpcHarness],
] as const;

describe.each(consumers)('%s owner mutation protocol', (_name, makeHarness) => {
  it('sends synchronously, then waits for ack → flush → a matching post-send snapshot', async () => {
    const h = makeHarness();
    const mutation = h.mutate();
    void mutation.catch(() => {});
    try {
      expect(h.events).toEqual(['send']);
      h.publish(false);
      h.ack.resolve();
      await vi.waitFor(() => expect(h.events).toContain('flush:start'));
      h.publish(true);
      h.flush.resolve();

      await mutation;
      expect(h.events).toEqual(['send', 'ack', 'flush:start', 'flush:done']);
      expect(h.frames).toHaveLength(1);
    } finally {
      try {
        h.dispose();
      } catch {
        // The RED OwnerRpcFs implementation has no dispose yet.
      }
      h.ack.resolve();
      h.flush.resolve();
      await mutation.catch(() => {});
    }
  });

  it('rejects the owner apply error without attempting a durability flush', async () => {
    const h = makeHarness();
    const mutation = h.mutate();
    void mutation.catch(() => {});
    h.publish(true);
    h.ack.reject(new Error('owner apply failed'));

    await expect(mutation).rejects.toThrow('owner apply failed');
    expect(h.events).toEqual(['send']);
    try {
      h.dispose();
    } catch {
      // RED compatibility; the assertion above owns this fault case.
    }
  });

  it('rejects a reflected mutation when the durability flush fails', async () => {
    const h = makeHarness();
    const mutation = h.mutate();
    void mutation.catch(() => {});
    h.ack.resolve();
    await vi.waitFor(() => expect(h.events).toContain('flush:start'));
    h.publish(true);
    h.flush.reject(new Error('OPFS quota exhausted'));

    await expect(mutation).rejects.toThrow('OPFS quota exhausted');
    try {
      h.dispose();
    } catch {
      // RED compatibility; the assertion above owns this fault case.
    }
  });

  it('bounds a missing reflection after ack and flush', async () => {
    const h = makeHarness(5);
    const mutation = h.mutate();
    h.ack.resolve();
    h.flush.resolve();

    await expect(mutation).rejects.toThrow(/did not reflect within 5ms/);
    try {
      h.dispose();
    } catch {
      // RED compatibility; the assertion above owns this fault case.
    }
  });

  it('does not count a snapshot emitted by owner lookup before the send', async () => {
    const h = makeHarness(5);
    h.publishOnNextOwnerRead();
    const mutation = h.mutate();
    h.ack.resolve();
    h.flush.resolve();

    await expect(mutation).rejects.toThrow(/did not reflect within 5ms/);
    try {
      h.dispose();
    } catch {
      // RED compatibility; the assertion above owns this fault case.
    }
  });

  it('dispose cancels pending work immediately and is idempotent', async () => {
    const h = makeHarness();
    const mutation = h.mutate();
    void mutation.catch(() => {});

    try {
      h.dispose();
    } catch (error) {
      h.ack.resolve();
      h.flush.resolve();
      h.publish(true);
      await mutation.catch(() => {});
      throw error;
    }
    h.dispose();
    await expect(mutation).rejects.toThrow(/disposed/);

    h.ack.resolve();
    h.flush.resolve();
  });
});
