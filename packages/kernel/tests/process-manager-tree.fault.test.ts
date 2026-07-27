import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKernelDispatcher } from '../src/ipc/kernel-dispatcher.ts';
import { SabRing, createSabRing } from '../src/ipc/sab-ring.ts';
import { decodeReply, encodeRequest } from '../src/ipc/sync-rpc.ts';
import {
  type ProcessIO,
  ProcessManager,
  installProcessFederation,
  readRootProcessSnapshot,
} from '../src/process-manager.ts';
import {
  KERNEL_PROCESS_SPEC_KEY,
  KERNEL_SYNC_CALL_KEY,
  publishKernelProcessSpec,
  publishKernelSyncApi,
} from '../src/shared-globals.ts';
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

interface BoundaryInit {
  readonly spec: {
    readonly syncRing: SharedArrayBuffer;
    readonly payloadCapacity: number;
    readonly stdio: { readonly ipc: MessagePort; readonly stdout: MessagePort };
  };
}

function initOf(worker: BoundaryWorker): BoundaryInit {
  return worker.posted[0] as BoundaryInit;
}

function captureControls(worker: BoundaryWorker): unknown[] {
  const controls: unknown[] = [];
  const port = initOf(worker).spec.stdio.ipc;
  port.onmessage = (event) => controls.push(event.data);
  port.start();
  return controls;
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

async function processRpc(method: string, payload: unknown, callerPid: number) {
  const { sab, ring } = createSabRing({ payloadCapacity: 2_048 });
  const caller = SabRing.attach(sab, 2_048);
  const dispatcher = getKernelDispatcher();
  dispatcher.attach(ring, { callerPid });
  return callProcessRpc(caller, method, payload).finally(() => dispatcher.detach(ring));
}

async function callProcessRpc(caller: SabRing, method: string, payload: unknown) {
  caller.writeRequest(encodeRequest({ method, payload }));
  return decodeReply(await caller.waitReplyAsync(5_000));
}

describe('ProcessManager owner-root process tree (ADR-0326)', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
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
    const channel = new MessageChannel();
    publishKernelProcessSpec({
      pid: 7,
      ppid: 1,
      argv: ['rifty'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: channel.port1,
        stderr: channel.port1,
        stdin: channel.port1,
        ipc: channel.port1,
      },
    });
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
    channel.port1.close();
    channel.port2.close();
  });

  it('does not federate an unrelated manager spawn from realm identity alone', () => {
    const calls: string[] = [];
    const channel = new MessageChannel();
    publishKernelProcessSpec({
      pid: 7,
      ppid: 1,
      argv: ['rifty'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: channel.port1,
        stderr: channel.port1,
        stdin: channel.port1,
        ipc: channel.port1,
      },
    });
    publishKernelSyncApi({
      call(method) {
        calls.push(method);
        return method === 'process.reserve' ? 41 : null;
      },
    });

    const child = new ProcessManager().spawn('owner-tool', liveUntilKilled);

    expect(child.pid).toBe(2);
    expect(calls).toEqual([]);
    child.kill();
    channel.port1.close();
    channel.port2.close();
  });

  it('settles a federated same-realm descendant that publishes its own exit code', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    publishKernelSyncApi({
      call(method, payload) {
        calls.push({ method, payload });
        return method === 'process.reserve' ? 41 : null;
      },
    });
    let finishHandler!: () => void;
    const handlerDone = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });
    const manager = new ProcessManager();
    const child = manager.spawn('git', () => handlerDone, 7, {
      cwd: '/workspace',
      federated: true,
    });

    child.exitCode = 127;
    child.emit('exit', 127, null);
    child.emit('close', 127, null);
    finishHandler();

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'process.settle',
        payload: { pid: 41, code: 127, signal: null },
      }),
    );
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
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

  it('keeps an owner-root remote PID published until its physical settle proof', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    const controls = captureControls(worker);
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
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

  it('keeps multi-hop descendants as kill routes outside an intermediate ledger', async () => {
    const relayed: string[] = [];
    publishKernelSyncApi({
      call(method) {
        relayed.push(method);
        return method === 'process.reserve' ? 7 : null;
      },
    });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    const controls = captureControls(worker);

    manager.reserveForwardedProcess(41, 'node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(41, owner.pid);
    manager.reserveForwardedProcess(42, 'node', 41, '/workspace', owner.pid);
    manager.commitRemoteProcess(42, owner.pid);

    expect(manager.snapshot()).toEqual([
      { pid: 1, ppid: 0, command: 'rifty' },
      { pid: owner.pid, ppid: 1, command: 'node' },
    ]);
    expect(manager.get(41)).toBeNull();
    manager.settleRemoteProcess(41, owner.pid, 0, null);
    expect(manager.kill(42, 'SIGTERM')).toBe(true);
    expect(manager.kill(42, 'SIGTERM')).toBe(false);
    await vi.waitFor(() =>
      expect(controls).toContainEqual({ kind: 'control:kill-tree', pid: 42, signal: 'SIGTERM' }),
    );

    owner.kill();
    expect(relayed.slice(-2)).toEqual(['process.peer-death', 'process.settle']);
  });

  it('fails loud before forgetting a forwarded route without upstream authority', () => {
    publishKernelSyncApi({ call: (method) => (method === 'process.reserve' ? 7 : null) });
    const manager = new ProcessManager();
    setWorkerFactoryForTests(() => new BoundaryWorker());
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    manager.reserveForwardedProcess(41, 'node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(41, owner.pid);

    Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
    expect(() => owner.kill()).toThrow(/process\.peer-death.*upstream authority/u);
  });

  it('validates reserve/commit before upstream and aborts a rejected relayed PID', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    publishKernelSyncApi({
      call(method, payload) {
        calls.push({ method, payload });
        return method === 'process.reserve' ? 7 : null;
      },
    });
    const manager = new ProcessManager();
    setWorkerFactoryForTests(() => new BoundaryWorker());
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    calls.length = 0;
    installProcessFederation(manager);

    const rejected = await processRpc(
      'process.reserve',
      { command: 'node', ppid: 999, cwd: '/workspace' },
      owner.pid,
    );
    expect(rejected).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(
      (
        await processRpc(
          'process.reserve',
          { command: 'node', ppid: owner.pid, cwd: '/workspace' },
          owner.pid,
        )
      ).ok,
    ).toBe(false);
    expect(calls.map(({ method }) => method)).toEqual(['process.reserve', 'process.abort']);
    calls.length = 0;
    expect((await processRpc('process.commit', { pid: 41 }, owner.pid)).ok).toBe(false);
    expect(calls).toEqual([]);
    owner.kill();
  });

  it('routes a worker-thread descendant through its exact trusted SAB attachment', async () => {
    const processWorker = new BoundaryWorker();
    const threadWorker = new BoundaryWorker();
    const workers = [processWorker, threadWorker];
    setWorkerFactoryForTests(() => workers.shift() ?? new BoundaryWorker());
    const manager = new ProcessManager();
    const process = manager.spawnWorker('node', workerSpec('process'));
    const thread = manager.spawnWorkerThread(workerSpec('thread'), {
      pid: process.pid,
      ppid: process.ppid,
    });
    installProcessFederation(manager);
    const threadInit = initOf(threadWorker);
    const threadControls = captureControls(threadWorker);
    const caller = SabRing.attach(threadInit.spec.syncRing, threadInit.spec.payloadCapacity);
    const reserved = await callProcessRpc(caller, 'process.reserve', {
      command: 'node',
      ppid: process.pid,
      cwd: '/workspace',
    });
    const childPid = Number(reserved.value);
    await callProcessRpc(caller, 'process.commit', { pid: childPid });

    expect(manager.kill(childPid)).toBe(true);
    expect(manager.snapshot()).toContainEqual({
      pid: childPid,
      ppid: process.pid,
      command: 'node',
    });
    await vi.waitFor(() =>
      expect(threadControls).toContainEqual({
        kind: 'control:kill-tree',
        pid: childPid,
        signal: 'SIGTERM',
      }),
    );
    thread.kill();
    expect(manager.snapshot()).not.toContainEqual({
      pid: childPid,
      ppid: process.pid,
      command: 'node',
    });
    process.kill();
  });

  it('terminates one hidden worker thread without killing its process siblings', () => {
    const processWorker = new BoundaryWorker();
    const childWorker = new BoundaryWorker();
    const targetThreadWorker = new BoundaryWorker();
    const siblingThreadWorker = new BoundaryWorker();
    const workers = [processWorker, childWorker, targetThreadWorker, siblingThreadWorker];
    setWorkerFactoryForTests(() => workers.shift() ?? new BoundaryWorker());
    const manager = new ProcessManager();
    const process = manager.spawnWorker('node', workerSpec('process'));
    const child = manager.spawnWorker('node', workerSpec('child'), process.pid);
    const identity = { pid: process.pid, ppid: process.ppid };
    const targetThread = manager.spawnWorkerThread(workerSpec('target-thread'), identity);
    manager.spawnWorkerThread(workerSpec('sibling-thread'), identity);

    expect(manager.snapshot()).toEqual([
      { pid: 1, ppid: 0, command: 'rifty' },
      { pid: process.pid, ppid: 1, command: 'node' },
      { pid: child.pid, ppid: process.pid, command: 'node' },
    ]);
    expect(targetThread.kill('SIGTERM')).toBe(true);
    expect(targetThreadWorker.terminate).toHaveBeenCalledTimes(1);
    expect(processWorker.terminate).not.toHaveBeenCalled();
    expect(childWorker.terminate).not.toHaveBeenCalled();
    expect(siblingThreadWorker.terminate).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([process, child]);

    expect(process.kill('SIGTERM')).toBe(true);
    expect(processWorker.terminate).toHaveBeenCalledTimes(1);
    expect(childWorker.terminate).toHaveBeenCalledTimes(1);
    expect(siblingThreadWorker.terminate).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it.each([
    {
      terminal: 'attested control-port close',
      trigger(port: MessagePort) {
        port.dispatchEvent(
          new MessageEvent('message', { data: { kind: 'control:exiting', code: 7 } }),
        );
        port.dispatchEvent(new Event('close'));
      },
    },
    {
      terminal: 'control:self-exit',
      trigger(port: MessagePort) {
        port.dispatchEvent(
          new MessageEvent('message', { data: { kind: 'control:self-exit', code: 7 } }),
        );
      },
    },
  ])('drains final stdout before $terminal settles the Worker', async ({ trigger }) => {
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const manager = new ProcessManager();
    const child = manager.spawnWorker('node', workerSpec('late-stdout'));
    if (child.kind !== 'worker') throw new Error('expected worker handle');
    const chunks: string[] = [];
    child.stdout().on('data', (chunk: unknown) => {
      chunks.push(new TextDecoder().decode(chunk as Uint8Array));
    });

    trigger(child.ports.ipc);
    initOf(worker).spec.stdio.stdout.postMessage(new TextEncoder().encode('late\n'));

    await vi.waitFor(() => expect(child.exitCode).toBe(7));
    expect(chunks.join('')).toBe('late\n');
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
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
