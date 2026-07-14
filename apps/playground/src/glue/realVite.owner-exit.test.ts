import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerVfsErrorFrame } from './owner-vfs-ipc.ts';
import type { HostCommitAck, HostCommitRequest } from './owner-vfs-protocol.ts';

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
    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack });
    await expect(pending).resolves.toEqual(ack);
  });

  it.each([
    ['a dropped terminal', null],
    [
      'a terminal with no outer operation id',
      {
        type: 'rifty:owner-vfs-commit-ack',
        ok: false,
        error: { kind: 'error', name: 'Error', message: 'missing identity' },
      },
    ],
    [
      'a terminal with a foreign outer operation id',
      {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: 'foreign-operation',
        ok: false,
        error: { kind: 'error', name: 'Error', message: 'foreign identity' },
      },
    ],
  ] as const)('autonomously replays the exact request after %s', async (_fault, terminal) => {
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

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: `autonomous-replay-${String(_fault)}`,
      path: '/workspace/replayed',
      expectedVersion: null,
    };
    const pending = handle.applyHostCommit(request);
    const commitPosts = (): unknown[] =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit' &&
          (message as { readonly request?: { readonly operationId?: unknown } }).request
            ?.operationId === request.operationId,
      );
    expect(commitPosts()).toEqual([{ type: 'rifty:owner-vfs-commit', request }]);
    if (terminal) fakeWorker.emit('message', terminal);

    await vi.advanceTimersByTimeAsync(249);
    expect(commitPosts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(commitPosts()).toEqual([
      { type: 'rifty:owner-vfs-commit', request },
      { type: 'rifty:owner-vfs-commit', request },
    ]);

    fakeWorker.die(137);
    await expect(pending).rejects.toThrow(/owner exited/);
  });

  it('replays a corrupt terminal immediately and re-arms one interval from that replay', async () => {
    vi.useFakeTimers();
    const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'corrupt-immediate-replay',
      path: '/workspace/replayed',
      expectedVersion: null,
    };
    const pending = handle.applyHostCommit(request);
    const commitCount = (): number =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit' &&
          (message as { readonly request?: { readonly operationId?: unknown } }).request
            ?.operationId === request.operationId,
      ).length;
    await vi.advanceTimersByTimeAsync(100);
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: { kind: 'error', name: '', message: 'corrupt terminal' },
    });
    expect(commitCount()).toBe(2);

    // The original t=250 timer was replaced, not duplicated. The next replay
    // belongs to the immediate t=100 send and therefore fires at t=350.
    await vi.advanceTimersByTimeAsync(249);
    expect(commitCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(commitCount()).toBe(3);

    fakeWorker.die(137);
    await expect(pending).rejects.toThrow(/owner exited/);
    protocolErrors.mockRestore();
  });

  it('rejects an initial conditional-commit send failure without arming replay', async () => {
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
    const send = vi.spyOn(fakeWorker, 'send');
    fakeWorker.alive = false;

    const pending = handle.applyHostCommit({
      kind: 'mkdir',
      operationId: 'initial-send-failed',
      path: '/workspace/not-sent',
      expectedVersion: null,
    });
    await expect(pending).rejects.toThrow(/send failed/);
    const commitAttempts = (): number =>
      send.mock.calls.filter(
        ([message]) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit',
      ).length;
    expect(commitAttempts()).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(commitAttempts()).toBe(1);
  });

  it.each([
    {
      fault: 'a forged non-null path version',
      candidate: {
        operationId: 'replace-forged-version',
        ownerEpoch: 'owner-a',
        treeRevision: 4,
        versions: [{ path: '/workspace/replaced', version: 'forged-v4' }],
      },
      exact: {
        operationId: 'replace-forged-version',
        ownerEpoch: 'owner-a',
        treeRevision: 5,
        versions: [{ path: '/workspace/replaced', version: 'exact-v5' }],
      },
    },
    {
      fault: 'a stale lower tree revision',
      candidate: {
        operationId: 'replace-stale-revision',
        ownerEpoch: 'owner-a',
        treeRevision: 2,
        versions: [{ path: '/workspace/replaced', version: 'stale-v2' }],
      },
      exact: {
        operationId: 'replace-stale-revision',
        ownerEpoch: 'owner-a',
        treeRevision: 4,
        versions: [{ path: '/workspace/replaced', version: 'exact-v4' }],
      },
    },
  ] as const)(
    'keeps success pending after $fault and lets a certified replay replace it',
    async ({ candidate, exact }) => {
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

      const request: HostCommitRequest = {
        kind: 'mkdir',
        operationId: candidate.operationId,
        path: '/workspace/replaced',
        expectedVersion: null,
      };
      const pending = handle.applyHostCommit(request);
      let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
      void pending.then(
        () => {
          settlement = 'resolved';
        },
        () => {
          settlement = 'rejected';
        },
      );
      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: true,
        ack: candidate,
      });
      await Promise.resolve();
      expect(settlement).toBe('pending');

      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: true,
        ack: exact,
      });
      await Promise.resolve();
      expect(settlement).toBe('pending');
      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-released',
        ack: candidate,
      });
      await Promise.resolve();
      expect(settlement).toBe('pending');

      fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: exact });
      await expect(pending).resolves.toEqual(exact);
    },
  );

  it('settles an exact success only after its matching owner release', async () => {
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

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'release-certified-success',
      path: '/workspace/certified',
      expectedVersion: null,
    };
    const ack: HostCommitAck = {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: request.path, version: 'v4' }],
    };
    const pending = handle.applyHostCommit(request);
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
    void pending.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack,
    });
    await Promise.resolve();
    expect(settlement).toBe('pending');

    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack });
    await expect(pending).resolves.toEqual(ack);
  });

  it('settles applied failure only after its exact owner release', async () => {
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

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'release-certified-applied-nack',
      path: '/workspace/applied',
      expectedVersion: null,
    };
    const applied: HostCommitAck = {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: request.path, version: 'v4' }],
    };
    const pending = handle.applyHostCommit(request);
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
    void pending.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: { kind: 'error', name: 'Error', message: 'publication failed' },
      applied,
    });
    await Promise.resolve();
    expect(settlement).toBe('pending');

    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: applied });
    await expect(pending).rejects.toMatchObject({
      name: 'VfsCommitAppliedError',
      applied,
      cause: { message: 'publication failed' },
    });
  });

  it('rejects an uncertified success when its captured owner exits', async () => {
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

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'uncertified-owner-exit',
      path: '/workspace/uncertified',
      expectedVersion: null,
    };
    const pending = handle.applyHostCommit(request);
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack: {
        operationId: request.operationId,
        ownerEpoch: 'owner-a',
        treeRevision: 4,
        versions: [{ path: request.path, version: 'v4' }],
      },
    });

    fakeWorker.die(137);
    await expect(pending).rejects.toThrow(/owner exited/);
  });

  it.each(['success', 'applied NACK'] as const)(
    'switches a staged %s from request replay to receipt-only retries',
    async (outcome) => {
      vi.useFakeTimers();
      const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { startWorkspaceOwner } = await importOwner();
      const handle = startWorkspaceOwner();
      fakeWorker.emit('message', {
        type: 'rifty:workspace-owner-ready',
        port: handle.snapshotPort,
        ownerEpoch: 'owner-a',
        treeRevision: 3,
      });
      await handle.ready;

      const request: HostCommitRequest = {
        kind: 'mkdir',
        operationId: `receipt-only-${outcome}`,
        path: '/workspace/receipt-only',
        expectedVersion: null,
      };
      const ack: HostCommitAck = {
        operationId: request.operationId,
        ownerEpoch: 'owner-a',
        treeRevision: 4,
        versions: [{ path: request.path, version: 'v4' }],
      };
      const pending = handle.applyHostCommit(request);
      void pending.catch(() => {});
      const terminal =
        outcome === 'success'
          ? {
              type: 'rifty:owner-vfs-commit-ack',
              operationId: request.operationId,
              ok: true,
              ack,
            }
          : {
              type: 'rifty:owner-vfs-commit-ack',
              operationId: request.operationId,
              ok: false,
              error: { kind: 'error', name: 'Error', message: 'publication failed' },
              applied: ack,
            };
      fakeWorker.emit('message', terminal);
      fakeWorker.emit('message', terminal);
      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: false,
        error: { kind: 'error', name: '', message: 'corrupt later terminal' },
      });
      const commitPosts = (): unknown[] =>
        fakeWorker.sent.filter(
          (message) =>
            !!message &&
            typeof message === 'object' &&
            (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit' &&
            (message as { readonly request?: { readonly operationId?: unknown } }).request
              ?.operationId === request.operationId,
        );
      const receipts = (): unknown[] =>
        fakeWorker.sent.filter(
          (message) =>
            !!message &&
            typeof message === 'object' &&
            (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit-received' &&
            (message as { readonly ack?: { readonly operationId?: unknown } }).ack?.operationId ===
              request.operationId,
        );
      expect(commitPosts()).toHaveLength(1);
      expect(receipts()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(commitPosts()).toHaveLength(1);
      expect(receipts().length).toBeGreaterThan(1);

      fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack });
      if (outcome === 'success') await expect(pending).resolves.toEqual(ack);
      else await expect(pending).rejects.toMatchObject({ name: 'VfsCommitAppliedError' });
      protocolErrors.mockRestore();
    },
  );

  it('receipts an exact conditional-commit terminal until the owner releases replay bytes', async () => {
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
      kind: 'mkdir',
      operationId: 'receipt-save',
      path: '/workspace/new-dir',
      expectedVersion: null,
    });
    const ack = {
      operationId: 'receipt-save',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/new-dir', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: ack.operationId,
      ok: true,
      ack,
    });

    const receipts = (): unknown[] =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit-received',
      );
    expect(receipts()).toEqual([{ type: 'rifty:owner-vfs-commit-received', ack }]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(receipts().length).toBeGreaterThan(1);
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-released',
      ack,
    });
    await expect(pending).resolves.toEqual(ack);
    const releasedCount = receipts().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(receipts()).toHaveLength(releasedCount);
  });

  it('ignores an unsolicited commit terminal without creating a receipt retry', async () => {
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

    const unsolicited = {
      operationId: 'unsolicited',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/ghost', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: unsolicited.operationId,
      ok: true,
      ack: unsolicited,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fakeWorker.sent).not.toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: unsolicited,
    });
  });

  it('does not let wrong-owner or divergent evidence settle or mask the exact terminal', async () => {
    vi.useFakeTimers();
    const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      kind: 'mkdir',
      operationId: 'correlated-save',
      path: '/workspace/exact',
      expectedVersion: null,
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
    const wrongOwner = {
      operationId: 'correlated-save',
      ownerEpoch: 'owner-stale',
      treeRevision: 4,
      versions: [{ path: '/workspace/exact', version: 'v4' }],
    };
    const divergent = {
      ...wrongOwner,
      ownerEpoch: 'owner-a',
      versions: [{ path: '/workspace/other', version: 'v4' }],
    };
    for (const ack of [wrongOwner, divergent]) {
      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: ack.operationId,
        ok: true,
        ack,
      });
      await Promise.resolve();
    }
    expect(settlement).toBe('pending');
    expect(protocolErrors).toHaveBeenCalledTimes(2);
    for (const call of protocolErrors.mock.calls) {
      expect(call[1]).toMatchObject({ name: 'VfsCommitProtocolError' });
    }
    expect(fakeWorker.sent).not.toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: wrongOwner,
    });
    expect(fakeWorker.sent).not.toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: divergent,
    });

    const exact = {
      operationId: 'correlated-save',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/exact', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: exact.operationId,
      ok: true,
      ack: exact,
    });
    expect(fakeWorker.sent).toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: exact,
    });
    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: exact });
    await expect(pending).resolves.toEqual(exact);
    protocolErrors.mockRestore();
  });

  it('clears staged terminal retries and rejects when the captured owner exits', async () => {
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
      kind: 'mkdir',
      operationId: 'exit-receipt',
      path: '/workspace/exact',
      expectedVersion: null,
    });
    const ack = {
      operationId: 'exit-receipt',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/exact', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: ack.operationId,
      ok: true,
      ack,
    });
    const receiptCount = (): number =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit-received',
      ).length;
    expect(receiptCount()).toBe(1);

    fakeWorker.die(0);
    await expect(pending).rejects.toThrow(/owner exited/);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(receiptCount()).toBe(1);
  });

  it('turns a malformed terminal into a protocol error without losing valid applied evidence', async () => {
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
      kind: 'mkdir',
      operationId: 'malformed-terminal',
      path: '/workspace/exact',
      expectedVersion: null,
    });
    const applied = {
      operationId: 'malformed-terminal',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/exact', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: applied.operationId,
      ok: false,
      error: {
        kind: 'version-conflict',
        name: 'VfsVersionConflictError',
        message: 'malformed bytes',
        path: '/workspace/exact',
        expectedVersion: null,
        actualVersion: 'remote',
        actualEntry: {
          path: '/workspace/exact',
          kind: 'file',
          size: 2,
          content: new Uint8Array([1]),
          version: 'remote',
        },
        ownerEpoch: 'owner-a',
        treeRevision: 4,
      },
      applied,
    });

    expect(fakeWorker.sent).toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: applied,
    });
    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: applied });
    await expect(pending).rejects.toMatchObject({
      name: 'VfsCommitAppliedError',
      applied,
      cause: { name: 'VfsCommitProtocolError' },
    });
  });

  it('replays the exact request after a malformed terminal without applied evidence', async () => {
    vi.useFakeTimers();
    const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;

    const request = {
      kind: 'mkdir' as const,
      operationId: 'malformed-replay',
      path: '/workspace/exact',
      expectedVersion: null,
    };
    const pending = handle.applyHostCommit(request);
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
    void pending.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );
    const commitPosts = (): unknown[] =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit',
      );
    expect(commitPosts()).toEqual([{ type: 'rifty:owner-vfs-commit', request }]);

    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: { kind: 'error', name: '', message: 7 },
    });
    await Promise.resolve();
    expect(settlement).toBe('pending');
    expect(protocolErrors).toHaveBeenCalledWith(
      '[real-vite/page] rejected divergent owner VFS terminal',
      expect.objectContaining({ name: 'VfsCommitProtocolError' }),
    );
    expect(commitPosts().length).toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(commitPosts().length).toBeGreaterThan(2);
    const exact = {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: request.path, version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack: exact,
    });
    expect(fakeWorker.sent).toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: exact,
    });
    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: exact });
    await expect(pending).resolves.toEqual(exact);
    protocolErrors.mockRestore();
  });

  it('replays every divergent NACK correlation sibling until an exact terminal arrives', async () => {
    vi.useFakeTimers();
    const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;

    const cases: readonly {
      readonly request: HostCommitRequest;
      readonly error: OwnerVfsErrorFrame;
      readonly exact: HostCommitAck;
    }[] = [
      {
        request: {
          kind: 'mkdir',
          operationId: 'reuse-correlation',
          path: '/workspace/reused',
          expectedVersion: null,
        },
        error: {
          kind: 'operation-id-reuse',
          name: 'OperationIdReuseError',
          message: 'wrong operation',
          operationId: 'reuse-correlation-other',
        },
        exact: {
          operationId: 'reuse-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [{ path: '/workspace/reused', version: 'v4' }],
        },
      },
      {
        request: {
          kind: 'write',
          operationId: 'write-correlation',
          path: '/workspace/write.txt',
          data: new Uint8Array([1]),
          expectedVersion: 'write-opened',
        },
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'wrong write expectation',
          path: '/workspace/write.txt',
          expectedVersion: 'write-other',
          actualVersion: null,
          actualEntry: null,
          ownerEpoch: 'owner-a',
          treeRevision: 4,
        },
        exact: {
          operationId: 'write-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [{ path: '/workspace/write.txt', version: 'v4' }],
        },
      },
      {
        request: {
          kind: 'mkdir',
          operationId: 'mkdir-correlation',
          path: '/workspace/new-dir',
          expectedVersion: null,
        },
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'wrong mkdir expectation',
          path: '/workspace/new-dir',
          expectedVersion: 'mkdir-other',
          actualVersion: 'mkdir-actual',
          actualEntry: {
            path: '/workspace/new-dir',
            kind: 'dir',
            size: 0,
            version: 'mkdir-actual',
          },
          ownerEpoch: 'owner-a',
          treeRevision: 4,
        },
        exact: {
          operationId: 'mkdir-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [{ path: '/workspace/new-dir', version: 'v4' }],
        },
      },
      {
        request: {
          kind: 'remove',
          operationId: 'remove-correlation',
          path: '/workspace/remove.txt',
          expectedVersion: 'remove-opened',
        },
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'wrong remove expectation',
          path: '/workspace/remove.txt',
          expectedVersion: 'remove-other',
          actualVersion: null,
          actualEntry: null,
          ownerEpoch: 'owner-a',
          treeRevision: 4,
        },
        exact: {
          operationId: 'remove-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [{ path: '/workspace/remove.txt', version: null }],
        },
      },
      {
        request: {
          kind: 'rename',
          operationId: 'rename-source-correlation',
          sourcePath: '/workspace/source-a.txt',
          targetPath: '/workspace/target-a.txt',
          expectedSourceVersion: 'source-opened',
          expectedTargetVersion: null,
        },
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'wrong rename source expectation',
          path: '/workspace/source-a.txt',
          expectedVersion: 'source-other',
          actualVersion: null,
          actualEntry: null,
          ownerEpoch: 'owner-a',
          treeRevision: 4,
        },
        exact: {
          operationId: 'rename-source-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [
            { path: '/workspace/source-a.txt', version: null },
            { path: '/workspace/target-a.txt', version: 'v4' },
          ],
        },
      },
      {
        request: {
          kind: 'rename',
          operationId: 'rename-target-correlation',
          sourcePath: '/workspace/source-b.txt',
          targetPath: '/workspace/target-b.txt',
          expectedSourceVersion: 'source-opened',
          expectedTargetVersion: null,
        },
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'wrong rename target expectation',
          path: '/workspace/target-b.txt',
          expectedVersion: 'target-other',
          actualVersion: 'target-actual',
          actualEntry: {
            path: '/workspace/target-b.txt',
            kind: 'dir',
            size: 0,
            version: 'target-actual',
          },
          ownerEpoch: 'owner-a',
          treeRevision: 4,
        },
        exact: {
          operationId: 'rename-target-correlation',
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [
            { path: '/workspace/source-b.txt', version: null },
            { path: '/workspace/target-b.txt', version: 'v4' },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      const pending = handle.applyHostCommit(testCase.request);
      let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
      void pending.then(
        () => {
          settlement = 'resolved';
        },
        () => {
          settlement = 'rejected';
        },
      );
      const commitPosts = (): unknown[] =>
        fakeWorker.sent.filter(
          (message) =>
            !!message &&
            typeof message === 'object' &&
            (message as { readonly type?: unknown; readonly request?: { operationId?: unknown } })
              .type === 'rifty:owner-vfs-commit' &&
            (message as { readonly request?: { operationId?: unknown } }).request?.operationId ===
              testCase.request.operationId,
        );
      expect(commitPosts()).toEqual([
        { type: 'rifty:owner-vfs-commit', request: testCase.request },
      ]);

      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: testCase.request.operationId,
        ok: false,
        error: testCase.error,
      });
      await Promise.resolve();
      expect(settlement).toBe('pending');
      expect(commitPosts().length).toBeGreaterThan(1);

      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: testCase.request.operationId,
        ok: true,
        ack: testCase.exact,
      });
      expect(fakeWorker.sent).toContainEqual({
        type: 'rifty:owner-vfs-commit-received',
        ack: testCase.exact,
      });
      fakeWorker.emit('message', {
        type: 'rifty:owner-vfs-commit-released',
        ack: testCase.exact,
      });
      await expect(pending).resolves.toEqual(testCase.exact);
    }

    expect(protocolErrors).toHaveBeenCalledTimes(cases.length);
    for (const call of protocolErrors.mock.calls) {
      expect(call[1]).toMatchObject({ name: 'VfsCommitProtocolError' });
    }
    protocolErrors.mockRestore();
  });

  it('preserves exact applied evidence when a NACK has divergent correlation evidence', async () => {
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

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'applied-divergent-correlation',
      path: '/workspace/applied-dir',
      expectedVersion: null,
    };
    const applied: HostCommitAck = {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: request.path, version: 'v4' }],
    };
    const pending = handle.applyHostCommit(request);
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: {
        kind: 'version-conflict',
        name: 'VfsVersionConflictError',
        message: 'wrong applied correlation',
        path: request.path,
        expectedVersion: 'unexpected-present-version',
        actualVersion: null,
        actualEntry: null,
        ownerEpoch: 'owner-a',
        treeRevision: 4,
      },
      applied,
    });

    expect(fakeWorker.sent).toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: applied,
    });
    fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: applied });
    await expect(pending).rejects.toMatchObject({
      name: 'VfsCommitAppliedError',
      applied,
      cause: { name: 'VfsCommitProtocolError' },
    });
  });

  it.each([
    {
      fault: 'wrong owner',
      operationId: 'applied-wrong-owner',
      path: '/workspace/wrong-owner',
      appliedOwnerEpoch: 'owner-stale',
      appliedPath: '/workspace/wrong-owner',
      appliedVersion: 'v4',
    },
    {
      fault: 'wrong path',
      operationId: 'applied-wrong-path',
      path: '/workspace/right-path',
      appliedOwnerEpoch: 'owner-a',
      appliedPath: '/workspace/other-path',
      appliedVersion: 'v4',
    },
    {
      fault: 'divergent version evidence',
      operationId: 'applied-divergent-version',
      path: '/workspace/version-evidence',
      appliedOwnerEpoch: 'owner-a',
      appliedPath: '/workspace/version-evidence',
      appliedVersion: null,
    },
  ] as const)(
    'replays after a structurally valid NACK carries applied evidence with $fault',
    async ({ operationId, path, appliedOwnerEpoch, appliedPath, appliedVersion }) => {
      vi.useFakeTimers();
      const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { startWorkspaceOwner } = await importOwner();
        const handle = startWorkspaceOwner();
        fakeWorker.emit('message', {
          type: 'rifty:workspace-owner-ready',
          port: handle.snapshotPort,
          ownerEpoch: 'owner-a',
          treeRevision: 3,
        });
        await handle.ready;

        const request: HostCommitRequest = {
          kind: 'mkdir',
          operationId,
          path,
          expectedVersion: null,
        };
        const applied: HostCommitAck = {
          operationId,
          ownerEpoch: appliedOwnerEpoch,
          treeRevision: 4,
          versions: [{ path: appliedPath, version: appliedVersion }],
        };
        const exact: HostCommitAck = {
          operationId,
          ownerEpoch: 'owner-a',
          treeRevision: 4,
          versions: [{ path, version: 'v4' }],
        };
        const pending = handle.applyHostCommit(request);
        let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
        void pending.then(
          () => {
            settlement = 'resolved';
          },
          () => {
            settlement = 'rejected';
          },
        );
        const commitPosts = (): unknown[] =>
          fakeWorker.sent.filter(
            (message) =>
              !!message &&
              typeof message === 'object' &&
              (message as { readonly type?: unknown; readonly request?: { operationId?: unknown } })
                .type === 'rifty:owner-vfs-commit' &&
              (message as { readonly request?: { operationId?: unknown } }).request?.operationId ===
                operationId,
          );

        expect(commitPosts()).toEqual([{ type: 'rifty:owner-vfs-commit', request }]);
        fakeWorker.emit('message', {
          type: 'rifty:owner-vfs-commit-ack',
          operationId,
          ok: false,
          error: { kind: 'error', name: 'Error', message: 'publication failed' },
          applied,
        });
        await Promise.resolve();

        expect(settlement).toBe('pending');
        expect(protocolErrors).toHaveBeenCalledWith(
          '[real-vite/page] rejected divergent owner VFS terminal',
          expect.objectContaining({ name: 'VfsCommitProtocolError' }),
        );
        expect(fakeWorker.sent).not.toContainEqual({
          type: 'rifty:owner-vfs-commit-received',
          ack: applied,
        });
        expect(commitPosts()).toEqual([
          { type: 'rifty:owner-vfs-commit', request },
          { type: 'rifty:owner-vfs-commit', request },
        ]);

        fakeWorker.emit('message', {
          type: 'rifty:owner-vfs-commit-ack',
          operationId,
          ok: true,
          ack: exact,
        });
        expect(fakeWorker.sent).toContainEqual({
          type: 'rifty:owner-vfs-commit-received',
          ack: exact,
        });
        fakeWorker.emit('message', { type: 'rifty:owner-vfs-commit-released', ack: exact });
        await expect(pending).resolves.toEqual(exact);
      } finally {
        protocolErrors.mockRestore();
      }
    },
  );

  it('ends malformed-terminal replay ownership on certified owner exit', async () => {
    vi.useFakeTimers();
    const protocolErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
    });
    await handle.ready;

    const request = {
      kind: 'mkdir' as const,
      operationId: 'malformed-exit',
      path: '/workspace/exact',
      expectedVersion: null,
    };
    const pending = handle.applyHostCommit(request);
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: { kind: 'error', name: '', message: 7 },
    });
    const commitCount = (): number =>
      fakeWorker.sent.filter(
        (message) =>
          !!message &&
          typeof message === 'object' &&
          (message as { readonly type?: unknown }).type === 'rifty:owner-vfs-commit',
      ).length;
    expect(commitCount()).toBeGreaterThan(1);

    fakeWorker.die(137);
    await expect(pending).rejects.toThrow(/owner exited/);
    const exitedCount = commitCount();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(commitCount()).toBe(exitedCount);
    protocolErrors.mockRestore();
  });

  it('receipts an applied NACK and rejects with exact already-applied evidence', async () => {
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
      kind: 'mkdir',
      operationId: 'publish-failed',
      path: '/workspace/applied-dir',
      expectedVersion: null,
    });
    const applied = {
      operationId: 'publish-failed',
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/workspace/applied-dir', version: 'v4' }],
    };
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: applied.operationId,
      ok: false,
      error: { kind: 'error', name: 'Error', message: 'snapshot publication failed' },
      applied,
    });

    expect(fakeWorker.sent).toContainEqual({
      type: 'rifty:owner-vfs-commit-received',
      ack: applied,
    });
    fakeWorker.emit('message', {
      type: 'rifty:owner-vfs-commit-released',
      ack: applied,
    });
    await expect(pending).rejects.toMatchObject({
      name: 'VfsCommitAppliedError',
      applied,
      cause: { message: 'snapshot publication failed' },
    });
    await vi.advanceTimersByTimeAsync(1_000);
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
