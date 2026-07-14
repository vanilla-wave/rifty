import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bug #4: on owner death the UI must leave 'running' AND post-exit writes must
// fail loudly instead of silently dropping through the snapshot-port fallback.
//
// We mock the transport boundaries only (kernel spawn, net registry, the two
// port bridges) and inject a fake worker EventEmitter, then drive the REAL
// `startWorkspaceOwner` wiring — the unit under test stays its exit/writeFile
// logic, not a re-implementation.

const sendVfsWriteSpy = vi.fn();
const readFileBytesSpy = vi.fn();
const spawnWorker = vi.fn();

vi.mock('@riftydev/kernel', () => ({
  globalProcessManager: {
    spawnWorker: (...args: unknown[]) => spawnWorker(...args),
  },
  isSabIpcSupported: () => true,
}));

vi.mock('@riftydev/net', () => ({
  bridgeCrossRealmPreview: () => ({ dispose: () => {} }),
  registerPort: () => {},
  unregisterPort: () => {},
}));

vi.mock('./vfs-write-port.ts', async () => {
  const actual = await vi.importActual<typeof import('./vfs-write-port.ts')>('./vfs-write-port.ts');
  return {
    ...actual,
    sendVfsWrite: (...args: unknown[]) => sendVfsWriteSpy(...args),
  };
});

vi.mock('./workspace-archive-port.ts', () => ({
  bridgeWorkspaceArchive: () => ({
    export: async () => '{}',
    import: async () => {},
    dispose: () => {},
  }),
}));

vi.mock('./workspace-file-read-port.ts', () => ({
  bridgeWorkspaceFileReads: () => ({
    readFileBytes: (...args: unknown[]) => readFileBytesSpy(...args),
    dispose: () => {},
  }),
}));

vi.mock('./preview-bridge-wiring.ts', () => ({
  mountPlaygroundPreviewBridge: () => () => {},
}));

// Worker URL imports (`?worker&url`) resolve to strings via the bundler; stub.
vi.mock('../workers/kernel-worker-entry.ts?worker&url', () => ({ default: 'kernel.js' }));
vi.mock('../workers/node-entry-bootstrap.ts?worker&url', () => ({ default: 'node.js' }));
vi.mock('../workers/real-vite-bootstrap.ts?worker&url', () => ({ default: 'boot.js' }));

/** Minimal faithful stand-in for the kernel `WorkerProcessHandle`. */
class FakeWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  /** Flips to false once exited — mirrors Node `subprocess.send` post-close. */
  alive = true;
  readonly sent: unknown[] = [];
  #stdout = new EventEmitter();
  #stderr = new EventEmitter();
  stdout(): EventEmitter {
    return this.#stdout;
  }
  stderr(): EventEmitter {
    return this.#stderr;
  }
  send(message: unknown): boolean {
    if (!this.alive) return false;
    this.sent.push(message);
    return true;
  }
  kill(): boolean {
    return true;
  }
  /** Simulate the worker dying: send() now returns false, exit fires. */
  die(code: number | null): void {
    this.alive = false;
    this.emit('exit', code);
  }
}

let fakeWorker: FakeWorker;

beforeEach(() => {
  vi.resetModules();
  sendVfsWriteSpy.mockClear();
  readFileBytesSpy.mockReset();
  readFileBytesSpy.mockResolvedValue(new Uint8Array([1, 2, 3]));
  fakeWorker = new FakeWorker();
  spawnWorker.mockReturnValue(fakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function importOwner(): Promise<typeof import('./realVite.ts')> {
  return import('./realVite.ts');
}

describe('Bug #4 — owner death: stale running + silent write loss', () => {
  it('holds TS-LSP requests until the owner reports ready', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    const request = {
      type: 'rifty:ts-lsp',
      request: { id: 1, type: 'ts:init', projectRoot: '/scratch' },
    };

    handle.sendTsLsp(request);
    await Promise.resolve();

    expect(
      fakeWorker.sent.some(
        (m) => !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:ts-lsp',
      ),
    ).toBe(false);

    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 0,
    });
    await handle.ready;
    await Promise.resolve();

    const tsFrame = fakeWorker.sent.find(
      (m) => !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:ts-lsp',
    );
    expect(tsFrame).toBeDefined();
  });

  it('notifies dev-server listeners with a non-running frame on owner exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const frames: { status: string }[] = [];
    handle.onDevServer((frame) => frames.push(frame));

    fakeWorker.die(0);

    // The listener must hear a frame whose status is NOT 'running' so the UI
    // can leave its stale running pill.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.status).not.toBe('running');
  });

  it('throws on writeFile after the owner has exited (no silent drop)', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    fakeWorker.die(137);

    expect(() => handle.writeFile('/workspace/a.txt', 'hi')).toThrow();
    // Must NOT have silently routed through the drop-prone snapshot fallback.
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('throws on writeFrame after the owner has exited (no silent drop)', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    fakeWorker.die(137);

    expect(() =>
      handle.writeFrame({
        type: 'rename',
        from: '/workspace/src/old.js',
        to: '/workspace/src/new.js',
      }),
    ).toThrow(/workspace owner has exited/);
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('rejects readFileBytes after the owner has exited (no stale download)', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    expect(handle.isAlive()).toBe(true);
    fakeWorker.die(137);

    expect(handle.isAlive()).toBe(false);
    await expect(handle.readFileBytes('/workspace/a.txt')).rejects.toThrow(/workspace owner/);
    expect(readFileBytesSpy).not.toHaveBeenCalled();
  });

  it('still writes through the live worker before exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    handle.writeFile('/workspace/a.txt', 'hi');

    // Live path: goes over worker.send as a rifty:vfs-write envelope.
    const writeIpc = fakeWorker.sent.find(
      (m): m is { type: string } =>
        !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:vfs-write',
    );
    expect(writeIpc).toBeDefined();
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('still sends writeFrame through the live worker before exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    handle.writeFrame({
      type: 'copy',
      from: '/workspace/src/a.js',
      to: '/workspace/src/a.copy.js',
    });

    const writeIpc = fakeWorker.sent.find(
      (m): m is { type: string; frame: { type: string } } =>
        !!m &&
        typeof m === 'object' &&
        (m as { type?: unknown }).type === 'rifty:vfs-write' &&
        (m as { frame?: { type?: unknown } }).frame?.type === 'copy',
    );
    expect(writeIpc).toBeDefined();
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('reads file bytes through the live owner read bridge before exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    await expect(handle.readFileBytes('/workspace/a.txt')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(readFileBytesSpy).toHaveBeenCalledWith('/workspace/a.txt');
  });

  it('resolves writeFrameAcked only after the owner sends an ack', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const acked = handle.writeFrameAcked({
      type: 'mkdir',
      path: '/workspace/acked',
      recursive: false,
    });

    const writeIpc = fakeWorker.sent.find(
      (m): m is { type: string; opId: string } =>
        !!m &&
        typeof m === 'object' &&
        (m as { type?: unknown }).type === 'rifty:vfs-write' &&
        typeof (m as { opId?: unknown }).opId === 'string',
    );
    expect(writeIpc).toBeDefined();
    if (!writeIpc) throw new Error('expected acked vfs write frame');
    let resolved = false;
    acked.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    fakeWorker.emit('message', { type: 'rifty:vfs-write-ack', opId: writeIpc.opId, ok: true });
    await acked;
    expect(resolved).toBe(true);
  });

  it('rejects writeFrameAcked with the owner-side apply error', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const acked = handle.writeFrameAcked({
      type: 'rename',
      from: '/workspace/a.txt',
      to: '/workspace/b.txt',
    });
    const writeIpc = fakeWorker.sent.find(
      (m): m is { type: string; opId: string } =>
        !!m &&
        typeof m === 'object' &&
        (m as { type?: unknown }).type === 'rifty:vfs-write' &&
        typeof (m as { opId?: unknown }).opId === 'string',
    );
    expect(writeIpc).toBeDefined();
    if (!writeIpc) throw new Error('expected acked vfs write frame');

    fakeWorker.emit('message', {
      type: 'rifty:vfs-write-ack',
      opId: writeIpc.opId,
      ok: false,
      error: { name: 'Error', message: '"b.txt" already exists' },
    });

    await expect(acked).rejects.toThrow(/already exists/);
  });

  it('rejects in-flight writeFrameAcked calls when the owner exits', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const acked = handle.writeFrameAcked({
      type: 'copy',
      from: '/workspace/a.txt',
      to: '/workspace/b.txt',
    });
    fakeWorker.die(137);

    await expect(acked).rejects.toThrow(/workspace owner exited/);
  });

  it('keeps package-sensitive VFS frames pending through the owner durability window', async () => {
    vi.useFakeTimers();
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const acked = handle.writeFrameAcked({
      type: 'write',
      path: '/workspace/package.json',
      data: new Uint8Array([1]),
    });
    const writeIpc = fakeWorker.sent.find(
      (message): message is { type: string; opId: string } =>
        !!message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'rifty:vfs-write' &&
        typeof (message as { opId?: unknown }).opId === 'string',
    );
    if (!writeIpc) throw new Error('expected acked package-sensitive VFS frame');
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
    void acked.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );

    // A failed pending-claim drain can require a second 30s removal drain.
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settlement).toBe('pending');

    fakeWorker.emit('message', {
      type: 'rifty:vfs-write-ack',
      opId: writeIpc.opId,
      ok: true,
    });
    await expect(acked).resolves.toBeUndefined();
  });

  it('keeps conditional commits pending through owner-owned durability drains', async () => {
    vi.useFakeTimers();
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;

    const pending = handle.applyHostCommit({
      kind: 'write',
      operationId: 'package-save',
      path: '/workspace/package.json',
      data: new Uint8Array([1]),
      expectedVersion: 'opened',
    });
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
    void pending.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );

    // The owner remains the only side that knows whether this mutation applied.
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settlement).toBe('pending');

    const ack = {
      operationId: 'package-save',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/package.json', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'package-save',
      ok: true,
      ack,
    });
    await expect(pending).resolves.toEqual(ack);
  });

  it('binds conditional commits to the ready owner and restores exact conflict evidence', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const { VfsVersionConflictError } = await import('./owner-vfs-protocol.ts');
    const { encodeOwnerVfsError } = await import('./owner-vfs-ipc.ts');
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;
    expect(handle.ownerEpoch).toBe('owner-a');

    const pending = handle.applyHostCommit({
      kind: 'write',
      operationId: 'host-save',
      path: '/workspace/large.bin',
      data: new Uint8Array([1]),
      expectedVersion: 'opened',
    });
    const request = fakeWorker.sent.find(
      (message): message is { type: string; request: { operationId: string } } =>
        !!message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'rifty:owner-vfs-commit',
    );
    expect(request?.request.operationId).toBe('host-save');

    const remote = new Uint8Array(192 * 1024 + 1);
    remote.fill(0x5a);
    const conflict = new VfsVersionConflictError({
      path: '/workspace/large.bin',
      expectedVersion: 'opened',
      actualVersion: 'guest',
      actualEntry: {
        path: '/workspace/large.bin',
        kind: 'file',
        size: remote.byteLength,
        content: remote,
        version: 'guest',
      },
      ownerEpoch: 'owner-a',
      treeRevision: 4,
    });
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'host-save',
      ok: false,
      error: encodeOwnerVfsError(conflict),
    });

    await expect(pending).rejects.toMatchObject({
      name: 'VfsVersionConflictError',
      actualVersion: 'guest',
      treeRevision: 4,
    });
    await pending.catch((error: unknown) => {
      expect(error).toBeInstanceOf(VfsVersionConflictError);
      expect((error as InstanceType<typeof VfsVersionConflictError>).actualBytes).toEqual(remote);
    });
  });

  it('returns the owner-bound durability receipt and rejects the barrier on owner exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 5,
    });
    await handle.ready;

    const durable = handle.durabilityBarrier(5);
    const request = fakeWorker.sent.find(
      (message): message is { type: string; barrierId: string; ownerEpoch: string } =>
        !!message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'rifty:owner-vfs-durability',
    );
    expect(request).toMatchObject({ ownerEpoch: 'owner-a' });
    if (!request) throw new Error('expected durability request');
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: request.barrierId,
      ok: true,
      receipt: { ownerEpoch: 'owner-a', treeRevision: 5, durability: 'durable' },
    });
    await expect(durable).resolves.toEqual({
      ownerEpoch: 'owner-a',
      treeRevision: 5,
      durability: 'durable',
    });

    const interrupted = handle.durabilityBarrier(5);
    fakeWorker.die(137);
    await expect(interrupted).rejects.toThrow(/workspace owner exited/);
  });
});
