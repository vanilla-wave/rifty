import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProcessIO, ProcessManager, readRootProcessSnapshot } from '../src/process-manager.ts';
import { KERNEL_SYNC_CALL_KEY, publishKernelSyncApi } from '../src/shared-globals.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';

class BoundaryWorker implements WorkerLike {
  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly posted: unknown[] = [];

  constructor(private readonly postFailure?: Error) {}

  postMessage(message: unknown): void {
    if (this.postFailure) throw this.postFailure;
    this.posted.push(message);
  }
}

function liveUntilKilled(io: ProcessIO): Promise<void> {
  return new Promise((resolve) =>
    io.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

function workerSpec(name = 'node'): Parameters<ProcessManager['spawnWorker']>[1] {
  return {
    entry: { kind: 'source', code: 'void 0;', sourceUrl: `/${name}.js` },
    argv: ['rifty', `/${name}.js`],
    env: {},
    cwd: '/workspace',
  };
}

describe('ProcessManager owner-root process tree (ADR-0326)', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    vi.restoreAllMocks();
  });

  it('takes one coherent PID/PPID snapshot and physically terminates a killed subtree once', () => {
    const manager = new ProcessManager();
    const parent = manager.spawn('nodemon', liveUntilKilled);
    const app = manager.spawn('node', liveUntilKilled, parent.pid);
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const nested = manager.spawnWorker('node', workerSpec('nested'), app.pid);

    const snapshot = manager
      .list()
      .map(({ pid, ppid, command }) => ({ pid, ppid, command }))
      .sort((left, right) => left.pid - right.pid);

    expect(snapshot).toEqual([
      { pid: parent.pid, ppid: 1, command: 'nodemon' },
      { pid: app.pid, ppid: parent.pid, command: 'node' },
      { pid: nested.pid, ppid: app.pid, command: 'node' },
    ]);

    const firstKill = parent.kill('SIGTERM');
    const duplicateKill = parent.kill('SIGTERM');

    expect(firstKill).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(app.signalCode).toBe('SIGTERM');
    expect(nested.signalCode).toBe('SIGTERM');
    expect(manager.list()).toEqual([]);
    expect(duplicateKill).toBe(false);
  });

  it('allocates a same-realm descendant in the owner-root PID ledger', () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    publishKernelSyncApi({
      call(method, payload) {
        calls.push({ method, payload });
        if (method === 'process.reserve') return 41;
        return null;
      },
    });
    const manager = new ProcessManager();

    const child = manager.spawn('ps', liveUntilKilled, 7, {
      cwd: '/workspace',
      federated: true,
    });

    expect(child.pid).toBe(41);
    expect(calls).toEqual([
      {
        method: 'process.reserve',
        payload: { command: 'ps', ppid: 7, cwd: '/workspace' },
      },
      { method: 'process.commit', payload: { pid: 41 } },
    ]);

    expect(child.kill('SIGTERM')).toBe(true);
    expect(calls.at(-1)).toEqual({
      method: 'process.settle',
      payload: { pid: 41, code: null, signal: 'SIGTERM' },
    });
  });

  it('reads nested ps state from one exact owner-root snapshot RPC', () => {
    publishKernelSyncApi({
      call(method, payload) {
        expect({ method, payload }).toEqual({ method: 'process.snapshot', payload: {} });
        return [
          { pid: 1, ppid: 0, command: 'rifty' },
          { pid: 8, ppid: 2, command: 'node' },
        ];
      },
    });

    expect(readRootProcessSnapshot()).toEqual([
      { pid: 1, ppid: 0, command: 'rifty' },
      { pid: 8, ppid: 2, command: 'node' },
    ]);
  });

  it('rejects requested federation before allocating without an upstream authority', () => {
    const manager = new ProcessManager();

    expect(() =>
      manager.spawn('node', liveUntilKilled, 7, {
        cwd: '/workspace',
        federated: true,
      }),
    ).toThrow(/federation.*without.*authority/i);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('keeps a remotely killed PID published until its physical settle proof', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    const init = worker.posted[0] as { spec: { stdio: { ipc: MessagePort } } };
    const controls: unknown[] = [];
    init.spec.stdio.ipc.onmessage = (event) => controls.push(event.data);
    init.spec.stdio.ipc.start();
    const pid = 41;
    manager.reserveForwardedProcess(pid, 'node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);

    expect(manager.kill(pid, 'SIGTERM')).toBe(true);
    expect(manager.snapshot()).toContainEqual({ pid, ppid: owner.pid, command: 'node' });
    await vi.waitFor(() =>
      expect(controls).toContainEqual({ kind: 'control:kill-tree', pid, signal: 'SIGTERM' }),
    );

    manager.settleRemoteProcess(pid, owner.pid, null, 'SIGTERM');
    expect(manager.snapshot()).not.toContainEqual({ pid, ppid: owner.pid, command: 'node' });
    owner.kill();
  });

  it('retires remote descendants when their physical owner Worker dies', () => {
    const manager = new ProcessManager();
    setWorkerFactoryForTests(() => new BoundaryWorker());
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);

    owner.kill();

    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('aborts a failed Worker reservation without publication or PID reuse', () => {
    const manager = new ProcessManager();
    const initFailure = new DOMException('init clone failed', 'DataCloneError');
    const failedWorker = new BoundaryWorker(initFailure);
    setWorkerFactoryForTests(() => failedWorker);

    expect(() => manager.spawnWorker('node', workerSpec('failed'))).toThrow(initFailure);
    expect(manager.list()).toEqual([]);
    expect(failedWorker.terminate).toHaveBeenCalledTimes(1);

    const liveWorker = new BoundaryWorker();
    setWorkerFactoryForTests(() => liveWorker);
    const next = manager.spawnWorker('node', workerSpec('next'));

    expect(next.pid).toBe(3);
    expect(manager.list()).toEqual([next]);
    next.kill();
  });

  it('rejects a reserved descendant when its owner dies before commit', () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', { ...workerSpec('nodemon'), serve: true });
    const childPid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);

    expect(owner.kill('SIGTERM')).toBe(true);
    expect(() => manager.commitRemoteProcess(childPid, owner.pid)).toThrow(
      `process.commit: PID ${String(childPid)} has no matching reservation`,
    );
    expect(manager.hasPendingRemoteProcess(childPid)).toBe(false);
    expect(manager.list()).toEqual([]);
  });

  it('returns a whole old or whole replacement table when snapshot races restart', async () => {
    const manager = new ProcessManager();
    const supervisor = manager.spawn('nodemon', liveUntilKilled);
    const oldApp = manager.spawn('node', liveUntilKilled, supervisor.pid);
    let replacement: ReturnType<ProcessManager['spawn']> | null = null;

    queueMicrotask(() => {
      oldApp.kill('SIGUSR2');
      replacement = manager.spawn('node', liveUntilKilled, supervisor.pid);
    });
    const racingSnapshot = manager
      .list()
      .map(({ pid, ppid, command }) => ({ pid, ppid, command }))
      .sort((left, right) => left.pid - right.pid);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (replacement === null) throw new Error('replacement microtask did not run');
    const replacementHandle = replacement as ReturnType<ProcessManager['spawn']>;
    const settledSnapshot = manager
      .list()
      .map(({ pid, ppid, command }) => ({ pid, ppid, command }))
      .sort((left, right) => left.pid - right.pid);

    expect(racingSnapshot).toEqual([
      { pid: supervisor.pid, ppid: 1, command: 'nodemon' },
      { pid: oldApp.pid, ppid: supervisor.pid, command: 'node' },
    ]);
    expect(settledSnapshot).toEqual([
      { pid: supervisor.pid, ppid: 1, command: 'nodemon' },
      { pid: replacementHandle.pid, ppid: supervisor.pid, command: 'node' },
    ]);
    expect(replacementHandle.pid).toBeGreaterThan(oldApp.pid);

    replacementHandle.kill();
    supervisor.kill();
  });
});
