import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProcessIO, ProcessManager } from '../src/process-manager.ts';
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

  constructor(private readonly postFailure?: Error) {}

  postMessage(): void {
    if (this.postFailure) throw this.postFailure;
  }
}

function liveUntilKilled(io: ProcessIO): Promise<void> {
  return new Promise((resolve) =>
    io.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

describe('ProcessManager owner-root process tree (ADR-0326)', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
  });

  afterEach(() => {
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
    const nested = manager.spawnWorker(
      'node',
      {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/nested.js' },
        argv: ['rifty', '/nested.js'],
        env: {},
        cwd: '/workspace',
      },
      app.pid,
    );

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

  it('aborts a failed Worker reservation without publication or PID reuse', () => {
    const manager = new ProcessManager();
    const initFailure = new DOMException('init clone failed', 'DataCloneError');
    const failedWorker = new BoundaryWorker(initFailure);
    setWorkerFactoryForTests(() => failedWorker);

    expect(() =>
      manager.spawnWorker('node', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/failed.js' },
        argv: ['rifty', '/failed.js'],
        env: {},
        cwd: '/workspace',
      }),
    ).toThrow(initFailure);
    expect(manager.list()).toEqual([]);
    expect(failedWorker.terminate).toHaveBeenCalledTimes(1);

    const liveWorker = new BoundaryWorker();
    setWorkerFactoryForTests(() => liveWorker);
    const next = manager.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/next.js' },
      argv: ['rifty', '/next.js'],
      env: {},
      cwd: '/workspace',
    });

    expect(next.pid).toBe(3);
    expect(manager.list()).toEqual([next]);
    next.kill();
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
