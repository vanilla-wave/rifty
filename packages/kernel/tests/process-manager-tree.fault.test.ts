import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKernelDispatcher } from '../src/ipc/kernel-dispatcher.ts';
import { SabRing, createSabRing } from '../src/ipc/sab-ring.ts';
import { decodeReply, encodeRequest } from '../src/ipc/sync-rpc.ts';
import {
  DESCENDANT_SETTLEMENT_DEADLINE_MS,
  type ProcessIO,
  type ProcessListeningControl,
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
import {
  type WorkerOutputState,
  bindWorkerStdioOutput,
  sealWorkerOutput,
  workerOutputAttestation,
} from '../src/worker-stdio-drain.ts';
import { attestedExit } from './attested-exit.ts';

class BoundaryWorker implements WorkerLike {
  readonly terminate = vi.fn();
  readonly posted: unknown[] = [];
  readonly #listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(private readonly postFailure?: Error) {}

  postMessage(message: unknown): void {
    if (this.postFailure) throw this.postFailure;
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  fire(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data });
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }
}

interface BoundaryInit {
  readonly spec: {
    readonly syncRing: SharedArrayBuffer;
    readonly payloadCapacity: number;
    readonly outputState: WorkerOutputState;
    readonly stdio: {
      readonly ipc: MessagePort;
      readonly stdout: MessagePort;
      readonly stderr: MessagePort;
    };
  };
}

function initOf(worker: BoundaryWorker): BoundaryInit {
  return worker.posted[0] as BoundaryInit;
}

function bindDesiredWorkerStdioOutput(
  port: MessagePort,
  state: WorkerOutputState,
  output: 'stdout' | 'stderr',
  controlPort: MessagePort,
): ReturnType<typeof bindWorkerStdioOutput> {
  return (
    bindWorkerStdioOutput as unknown as (
      outputPort: MessagePort,
      outputState: WorkerOutputState,
      outputName: 'stdout' | 'stderr',
      orderPort: MessagePort,
    ) => ReturnType<typeof bindWorkerStdioOutput>
  )(port, state, output, controlPort);
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

const discardOutput = { write(_bytes: Uint8Array): void {} };

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

function drainCapturedMicrotasks(tasks: (() => void)[]): unknown {
  let failure: unknown;
  while (tasks.length > 0) {
    const task = tasks.shift();
    if (task === undefined) continue;
    try {
      task();
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'captured microtasks failed');
    }
  }
  return failure;
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

  it('attempts the full owner-root teardown when a descendant listener throws', () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', workerSpec('owner'));
    const throwingChild = manager.spawn('node', liveUntilKilled, owner.pid);
    const sibling = manager.spawn('helper', liveUntilKilled, owner.pid);
    const events: string[] = [];
    throwingChild.on('exit', () => {
      events.push('throwing-exit');
      throw new Error('injected descendant exit failure');
    });
    throwingChild.on('close', () => {
      events.push('throwing-close');
      throw new Error('injected descendant close failure');
    });
    sibling.on('exit', () => events.push('sibling-exit'));

    let failure: unknown;
    try {
      owner.kill('SIGTERM');
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error) => String(error))).toEqual([
      expect.stringMatching(/injected descendant exit failure/u),
      expect.stringMatching(/injected descendant close failure/u),
    ]);
    expect(events).toEqual(['throwing-exit', 'throwing-close', 'sibling-exit']);
    expect(throwingChild.signalCode).toBe('SIGTERM');
    expect(sibling.signalCode).toBe('SIGTERM');
    expect(owner.signalCode).toBe('SIGTERM');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
    expect(owner.kill()).toBe(false);
  });

  it('retires a naturally exiting Worker owner after a descendant listener throws', () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'));
    const child = manager.spawn('helper', liveUntilKilled, owner.pid);
    const events: string[] = [];
    child.on('exit', () => {
      throw new Error('injected natural-exit descendant failure');
    });
    owner.on('exit', (code, signal) => events.push(`exit:${String(code)}/${String(signal)}`));
    owner.on('close', (code, signal) => events.push(`close:${String(code)}/${String(signal)}`));
    const microtasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => microtasks.push(task));

    expect(sealWorkerOutput(initOf(worker).spec.outputState)).toBe(true);
    expect(() =>
      worker.fire('message', attestedExit(worker, 0) as unknown as MessageEvent),
    ).not.toThrow();
    const failure = drainCapturedMicrotasks(microtasks);

    expect(String(failure)).toMatch(/injected natural-exit descendant failure/u);
    expect(events).toEqual(['exit:0/null', 'close:0/null']);
    expect(child.signalCode).toBe('SIGTERM');
    expect(owner.exitCode).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('settles a failed same-realm handler after its stderr listener throws', async () => {
    const microtasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => microtasks.push(task));
    const manager = new ProcessManager();
    const child = manager.spawn('helper', async () => {
      throw new Error('injected handler failure');
    });
    const events: string[] = [];
    child.on('stderr', () => {
      throw new Error('injected stderr listener failure');
    });
    child.on('exit', (code, signal) => events.push(`exit:${String(code)}/${String(signal)}`));
    child.on('close', (code, signal) => events.push(`close:${String(code)}/${String(signal)}`));
    const handlerTask = microtasks.shift();
    if (handlerTask === undefined) throw new Error('missing same-realm handler task');

    let failure: unknown;
    try {
      await handlerTask();
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toMatch(/injected stderr listener failure/u);
    expect(events).toEqual(['exit:1/null', 'close:1/null']);
    expect(child.exitCode).toBe(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('allocates a same-realm descendant in the owner-root PID ledger', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const channel = new MessageChannel();
    publishKernelProcessSpec({
      pid: 7,
      ppid: 1,
      argv: ['rifty'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: discardOutput,
        stderr: discardOutput,
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
    await vi.waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'process.settle',
        payload: { pid: 41, code: null, signal: 'SIGTERM' },
      }),
    );
    channel.port1.close();
    channel.port2.close();
  });

  it('rolls back a physical Worker synchronously when its federation commit is rejected', () => {
    const commitFailure = new Error('process.commit: PID 41 has no matching reservation');
    const calls: Array<{ method: string; payload: unknown }> = [];
    const worker = new BoundaryWorker();
    let outputState: WorkerOutputState | null = null;
    publishKernelSyncApi({
      call(method, payload) {
        calls.push({ method, payload });
        if (method === 'process.reserve') return 41;
        if (method === 'process.commit') {
          outputState = initOf(worker).spec.outputState;
          Atomics.store(new Int32Array(outputState), 1, 1);
          throw commitFailure;
        }
        return null;
      },
    });
    const dispatcher = getKernelDispatcher();
    const detach = vi.spyOn(dispatcher, 'detach');
    const manager = new ProcessManager();
    setWorkerFactoryForTests(() => worker);

    expect(() =>
      manager.spawnWorker('node', workerSpec(), 7, {
        cwd: '/workspace',
        federated: true,
      }),
    ).toThrow(commitFailure);

    if (outputState === null) throw new Error('commit did not observe the Worker output state');
    Atomics.store(new Int32Array(outputState), 1, 0);
    Atomics.notify(new Int32Array(outputState), 1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(manager.list()).toEqual([]);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
    expect(calls).toEqual([
      {
        method: 'process.reserve',
        payload: { command: 'node', ppid: 7, cwd: '/workspace' },
      },
      { method: 'process.commit', payload: { pid: 41 } },
      { method: 'process.abort', payload: { pid: 41 } },
    ]);
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
        stdout: discardOutput,
        stderr: discardOutput,
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

  it('publishes a federated same-realm settle after close-listener microtasks', async () => {
    const events: string[] = [];
    publishKernelSyncApi({
      call(method) {
        if (method === 'process.reserve') return 41;
        events.push(method);
        return null;
      },
    });
    let finishHandler!: () => void;
    const handlerDone = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });
    const manager = new ProcessManager();
    const child = manager.spawn('helper', () => handlerDone, 7, {
      cwd: '/workspace',
      federated: true,
    });
    child.on('close', () => {
      events.push('close');
      queueMicrotask(() => events.push('close-microtask'));
    });
    events.length = 0;

    finishHandler();

    await vi.waitFor(() => expect(events).toContain('process.settle'));
    expect(events).toEqual(['close', 'close-microtask', 'process.settle']);
  });

  it('publishes a federated Worker settle only after close listeners and their microtasks', async () => {
    const events: string[] = [];
    publishKernelSyncApi({
      call(method) {
        if (method === 'process.reserve') return 41;
        events.push(method);
        return null;
      },
    });
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const manager = new ProcessManager();
    const child = manager.spawnWorker('node', workerSpec('federated-close'), 7, {
      federated: true,
    });
    child.on('close', () => {
      events.push('close');
      queueMicrotask(() => events.push('close-microtask'));
    });
    events.length = 0;

    expect(sealWorkerOutput(initOf(worker).spec.outputState)).toBe(true);
    worker.fire('message', attestedExit(worker, 0) as unknown as MessageEvent);

    await vi.waitFor(() => expect(events).toContain('process.settle'));
    expect(events).toEqual(['close', 'close-microtask', 'process.settle']);
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

  it('keeps a killed physical owner output-open until its remote descendants settle', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', { ...workerSpec('nodemon'), serve: true });
    if (owner.kind !== 'worker') throw new Error('expected Worker owner');
    const controls = captureControls(worker);
    const orderFrames: unknown[] = [];
    const userMessages: unknown[] = [];
    owner.ports.ipc.addEventListener('message', (event) => orderFrames.push(event.data));
    owner.ports.ipc.start();
    owner.on('message', (message) => userMessages.push(message));
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);
    const output: string[] = [];
    owner.stdout().on('data', (chunk: unknown) => {
      output.push(new TextDecoder().decode(chunk as Uint8Array));
    });
    const stdout = bindDesiredWorkerStdioOutput(
      initOf(worker).spec.stdio.stdout,
      initOf(worker).spec.outputState,
      'stdout',
      initOf(worker).spec.stdio.ipc,
    );

    expect(owner.kill('SIGTERM')).toBe(true);
    await vi.waitFor(() =>
      expect(controls).toContainEqual({ kind: 'control:kill-tree', pid, signal: 'SIGTERM' }),
    );
    expect(owner.signalCode).toBeNull();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(() => stdout.write(new TextEncoder().encode('descendant closed\n'))).not.toThrow();

    manager.settleRemoteProcess(pid, owner.pid, null, 'SIGTERM');

    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(output.join('')).toBe('descendant closed\n');
    expect(orderFrames).toStrictEqual([
      {
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 0,
        attestation: workerOutputAttestation(initOf(worker).spec.outputState),
      },
    ]);
    expect(userMessages).toEqual([]);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('cuts an unresponsive physical owner once the descendant proof misses its deadline', async () => {
    // The settlement proof travels INTO the owner realm as `control:kill-tree`,
    // so a guest that stopped reading its port (synchronous loop, long build)
    // can never produce it. Waiting forever would make `kill()` claim a death
    // that never happens and wedge the dev loop with the CPU pegged; the
    // ordered path gets a deadline, then the physical cut proceeds loudly.
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', { ...workerSpec('nodemon'), serve: true });
    if (owner.kind !== 'worker') throw new Error('expected Worker owner');
    const stderr: string[] = [];
    owner.stderr().on('data', (chunk: unknown) => {
      stderr.push(new TextDecoder().decode(chunk as Uint8Array));
    });
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);

    expect(owner.kill('SIGTERM')).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();

    // No `settleRemoteProcess` ever arrives — the realm is not reading.
    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'), {
      timeout: DESCENDANT_SETTLEMENT_DEADLINE_MS * 3,
    });

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(stderr.join('')).toContain('descendant');
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('releases a killed physical owner barrier on exact descendant peer death', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', { ...workerSpec('nodemon'), serve: true });
    installProcessFederation(manager);
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
    const reserved = await callProcessRpc(caller, 'process.reserve', {
      command: 'node',
      ppid: owner.pid,
      cwd: '/workspace',
    });
    const pid = Number(reserved.value);
    expect(await callProcessRpc(caller, 'process.commit', { pid })).toEqual({
      ok: true,
      value: null,
    });

    expect(owner.kill('SIGTERM')).toBe(true);
    expect(owner.signalCode).toBeNull();
    expect(
      await callProcessRpc(caller, 'process.peer-death', {
        pid,
        message: 'descendant peer closed',
      }),
    ).toEqual({ ok: true, value: null });

    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('lets authenticated owner peer-close bypass an unresolved descendant barrier', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', { ...workerSpec('nodemon'), serve: true });
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);

    expect(owner.kill('SIGTERM')).toBe(true);
    expect(owner.signalCode).toBeNull();
    expect(sealWorkerOutput(initOf(worker).spec.outputState)).toBe(true);
    initOf(worker).spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });

    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('routes descendant listening and peer-death removal with the attested PID', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    if (owner.kind !== 'worker') throw new Error('expected Worker owner');
    const controls: ProcessListeningControl[] = [];
    owner.onListeningControl((control) => controls.push(control));
    installProcessFederation(manager);
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
    const reserved = await callProcessRpc(caller, 'process.reserve', {
      command: 'node',
      ppid: owner.pid,
      cwd: '/workspace',
    });
    const pid = Number(reserved.value);
    expect((await callProcessRpc(caller, 'process.commit', { pid })).ok).toBe(true);

    const listening = await callProcessRpc(caller, 'process.listening', {
      pid,
      ports: [3000],
      previewScope: 'nodemon-run',
    });
    expect(listening).toEqual({ ok: true, value: null });
    expect(controls).toEqual([{ pid, ports: [3000], previewScope: 'nodemon-run' }]);

    const peerDeath = await callProcessRpc(caller, 'process.peer-death', {
      pid,
      message: 'app Worker peer closed',
    });
    expect(peerDeath).toEqual({ ok: true, value: null });
    expect(controls).toEqual([
      { pid, ports: [3000], previewScope: 'nodemon-run' },
      { pid, ports: [] },
    ]);
    owner.kill();
  });

  it('removes descendant listening before a normal remote settle retires its PID', async () => {
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    if (owner.kind !== 'worker') throw new Error('expected Worker owner');
    const controls: ProcessListeningControl[] = [];
    let publishedDuringRemoval = false;
    owner.onListeningControl((control) => {
      controls.push(control);
      if (control.ports.length === 0) {
        publishedDuringRemoval = manager.snapshot().some(({ pid }) => pid === control.pid);
      }
    });
    installProcessFederation(manager);
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
    const reserved = await callProcessRpc(caller, 'process.reserve', {
      command: 'node',
      ppid: owner.pid,
      cwd: '/workspace',
    });
    const pid = Number(reserved.value);
    expect((await callProcessRpc(caller, 'process.commit', { pid })).ok).toBe(true);
    expect(
      await callProcessRpc(caller, 'process.listening', {
        pid,
        ports: [3000],
        previewScope: 'nodemon-run',
      }),
    ).toEqual({ ok: true, value: null });

    expect(
      await callProcessRpc(caller, 'process.settle', {
        pid,
        code: 0,
        signal: null,
      }),
    ).toEqual({ ok: true, value: null });

    expect(controls).toEqual([
      { pid, ports: [3000], previewScope: 'nodemon-run' },
      { pid, ports: [] },
    ]);
    expect(publishedDuringRemoval).toBe(true);
    expect(manager.snapshot()).not.toContainEqual({ pid, ppid: owner.pid, command: 'node' });
    owner.kill();
  });

  it.each(['settle', 'peer-death'] as const)(
    'releases the owner barrier when a %s listening-removal listener throws',
    async (terminal) => {
      const manager = new ProcessManager();
      const worker = new BoundaryWorker();
      setWorkerFactoryForTests(() => worker);
      const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
      if (owner.kind !== 'worker') throw new Error('expected Worker owner');
      owner.onListeningControl((control) => {
        if (control.ports.length === 0) {
          throw new Error(`injected ${terminal} listening-removal failure`);
        }
      });
      installProcessFederation(manager);
      const init = initOf(worker);
      const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
      const reserved = await callProcessRpc(caller, 'process.reserve', {
        command: 'node',
        ppid: owner.pid,
        cwd: '/workspace',
      });
      const pid = Number(reserved.value);
      expect((await callProcessRpc(caller, 'process.commit', { pid })).ok).toBe(true);
      expect(
        await callProcessRpc(caller, 'process.listening', {
          pid,
          ports: [3000],
          previewScope: 'nodemon-run',
        }),
      ).toEqual({ ok: true, value: null });

      expect(owner.kill('SIGTERM')).toBe(true);
      expect(owner.signalCode).toBeNull();
      const reply = await callProcessRpc(
        caller,
        `process.${terminal}`,
        terminal === 'settle'
          ? { pid, code: 0, signal: null }
          : { pid, message: 'app Worker peer closed' },
      );

      expect(reply.ok).toBe(false);
      expect(reply.error?.message).toMatch(
        new RegExp(`injected ${terminal} listening-removal failure`, 'u'),
      );
      await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
    },
  );

  it.each(['settle', 'peer-death'] as const)(
    'does not let a silent higher PID %s tombstone an older listening PID',
    async (terminal) => {
      const manager = new ProcessManager();
      const worker = new BoundaryWorker();
      setWorkerFactoryForTests(() => worker);
      const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
      if (owner.kind !== 'worker') throw new Error('expected Worker owner');
      const controls: ProcessListeningControl[] = [];
      owner.onListeningControl((control) => controls.push(control));
      installProcessFederation(manager);
      const init = initOf(worker);
      const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
      const reserve = async (): Promise<number> => {
        const reserved = await callProcessRpc(caller, 'process.reserve', {
          command: 'node',
          ppid: owner.pid,
          cwd: '/workspace',
        });
        const pid = Number(reserved.value);
        expect(await callProcessRpc(caller, 'process.commit', { pid })).toEqual({
          ok: true,
          value: null,
        });
        return pid;
      };
      const advertisedPid = await reserve();
      expect(
        await callProcessRpc(caller, 'process.listening', {
          pid: advertisedPid,
          ports: [3000],
          previewScope: 'older-run',
        }),
      ).toEqual({ ok: true, value: null });
      const silentPid = await reserve();

      const terminalReply =
        terminal === 'settle'
          ? await callProcessRpc(caller, 'process.settle', {
              pid: silentPid,
              code: 0,
              signal: null,
            })
          : await callProcessRpc(caller, 'process.peer-death', {
              pid: silentPid,
              message: 'silent descendant peer closed',
            });

      expect(terminalReply).toEqual({ ok: true, value: null });
      expect(controls).toEqual([{ pid: advertisedPid, ports: [3000], previewScope: 'older-run' }]);
      owner.kill();
    },
  );

  it('relays multi-hop listening removal before retiring the forwarded route', async () => {
    const relayed: Array<{ method: string; payload: unknown }> = [];
    let reserveCount = 0;
    publishKernelSyncApi({
      call(method, payload) {
        relayed.push({ method, payload });
        return method === 'process.reserve' ? (++reserveCount === 1 ? 7 : 41) : null;
      },
    });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    installProcessFederation(manager);
    relayed.length = 0;
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);

    expect(
      await callProcessRpc(caller, 'process.reserve', {
        command: 'node',
        ppid: owner.pid,
        cwd: '/workspace',
      }),
    ).toEqual({ ok: true, value: 41 });
    expect(await callProcessRpc(caller, 'process.commit', { pid: 41 })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await callProcessRpc(caller, 'process.listening', {
        pid: 41,
        ports: [3000],
        previewScope: 'nested-run',
      }),
    ).toEqual({ ok: true, value: null });
    expect(
      await callProcessRpc(caller, 'process.settle', {
        pid: 41,
        code: 0,
        signal: null,
      }),
    ).toEqual({ ok: true, value: null });

    expect(relayed).toEqual([
      {
        method: 'process.reserve',
        payload: { command: 'node', ppid: owner.pid, cwd: '/workspace' },
      },
      { method: 'process.commit', payload: { pid: 41 } },
      {
        method: 'process.listening',
        payload: { pid: 41, ports: [3000], previewScope: 'nested-run' },
      },
      { method: 'process.settle', payload: { pid: 41, code: 0, signal: null } },
    ]);
    expect(manager.kill(41)).toBe(false);
    owner.kill();
  });

  it.each(['settle', 'peer-death'] as const)(
    'releases a forwarded owner barrier after an upstream %s failure',
    async (terminal) => {
      let reserveCount = 0;
      publishKernelSyncApi({
        call(method, payload) {
          if (method === 'process.reserve') return ++reserveCount === 1 ? 7 : 41;
          if (
            method === `process.${terminal}` &&
            (payload as { readonly pid?: number }).pid === 41
          ) {
            throw new Error(`injected upstream ${terminal} failure`);
          }
          return null;
        },
      });
      const manager = new ProcessManager();
      const worker = new BoundaryWorker();
      setWorkerFactoryForTests(() => worker);
      const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
      installProcessFederation(manager);
      const init = initOf(worker);
      const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
      expect(
        await callProcessRpc(caller, 'process.reserve', {
          command: 'node',
          ppid: owner.pid,
          cwd: '/workspace',
        }),
      ).toEqual({ ok: true, value: 41 });
      expect(await callProcessRpc(caller, 'process.commit', { pid: 41 })).toEqual({
        ok: true,
        value: null,
      });

      expect(owner.kill('SIGTERM')).toBe(true);
      expect(owner.signalCode).toBeNull();
      const reply = await callProcessRpc(
        caller,
        `process.${terminal}`,
        terminal === 'settle'
          ? { pid: 41, code: null, signal: 'SIGTERM' }
          : { pid: 41, message: 'forwarded peer closed' },
      );

      expect(reply.ok).toBe(false);
      expect(reply.error?.message).toMatch(
        new RegExp(`injected upstream ${terminal} failure`, 'u'),
      );
      await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(manager.kill(41)).toBe(false);
      expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
    },
  );

  it('drops a forwarded reservation after an upstream abort failure', async () => {
    let reserveCount = 0;
    publishKernelSyncApi({
      call(method, payload) {
        if (method === 'process.reserve') return ++reserveCount === 1 ? 7 : 41;
        if (method === 'process.abort' && (payload as { readonly pid?: number }).pid === 41) {
          throw new Error('injected upstream abort failure');
        }
        return null;
      },
    });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    installProcessFederation(manager);
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
    expect(
      await callProcessRpc(caller, 'process.reserve', {
        command: 'node',
        ppid: owner.pid,
        cwd: '/workspace',
      }),
    ).toEqual({ ok: true, value: 41 });
    expect(manager.hasPendingRemoteProcess(41)).toBe(true);

    const reply = await callProcessRpc(caller, 'process.abort', { pid: 41 });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toMatch(/injected upstream abort failure/u);
    expect(manager.hasPendingRemoteProcess(41)).toBe(false);
    owner.kill();
  });

  it('waits for every postorder multi-hop kill route before cutting its physical owner', async () => {
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
    expect(owner.kill('SIGTERM')).toBe(true);
    expect(owner.kill('SIGTERM')).toBe(false);
    await vi.waitFor(() =>
      expect(controls).toEqual([
        { kind: 'control:kill-tree', pid: 42, signal: 'SIGTERM' },
        { kind: 'control:kill-tree', pid: 41, signal: 'SIGTERM' },
      ]),
    );
    expect(owner.signalCode).toBeNull();
    expect(worker.terminate).not.toHaveBeenCalled();

    manager.settleRemoteProcess(41, owner.pid, null, 'SIGTERM');
    await Promise.resolve();
    expect(owner.signalCode).toBeNull();
    manager.settleRemoteProcess(42, owner.pid, null, 'SIGTERM');

    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
    await vi.waitFor(() => expect(relayed.at(-1)).toBe('process.settle'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('cancels admitted reservations and rejects late commit or reserve after owner kill', async () => {
    const upstream: Array<{ method: string; payload: unknown }> = [];
    const reservedPids = [7, 41, 42];
    publishKernelSyncApi({
      call(method, payload) {
        upstream.push({ method, payload });
        if (method === 'process.reserve') return reservedPids.shift();
        return null;
      },
    });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    installProcessFederation(manager);
    const init = initOf(worker);
    const caller = SabRing.attach(init.spec.syncRing, init.spec.payloadCapacity);
    const pending = Number(
      (
        await callProcessRpc(caller, 'process.reserve', {
          command: 'node',
          ppid: owner.pid,
          cwd: '/workspace',
        })
      ).value,
    );
    const committed = Number(
      (
        await callProcessRpc(caller, 'process.reserve', {
          command: 'node',
          ppid: owner.pid,
          cwd: '/workspace',
        })
      ).value,
    );
    expect(await callProcessRpc(caller, 'process.commit', { pid: committed })).toEqual({
      ok: true,
      value: null,
    });
    upstream.length = 0;

    expect(owner.kill('SIGTERM')).toBe(true);
    expect(upstream).toContainEqual({ method: 'process.abort', payload: { pid: pending } });
    const beforeLateAdmission = upstream.length;
    expect((await callProcessRpc(caller, 'process.commit', { pid: pending })).ok).toBe(false);
    expect(
      (
        await callProcessRpc(caller, 'process.reserve', {
          command: 'node',
          ppid: owner.pid,
          cwd: '/workspace',
        })
      ).ok,
    ).toBe(false);
    expect(upstream).toHaveLength(beforeLateAdmission);
    expect(owner.signalCode).toBeNull();

    expect(
      await callProcessRpc(caller, 'process.settle', {
        pid: committed,
        code: null,
        signal: 'SIGTERM',
      }),
    ).toEqual({ ok: true, value: null });
    await vi.waitFor(() => expect(owner.signalCode).toBe('SIGTERM'));
  });

  it('fails loud but still retires a terminal owner without upstream authority', async () => {
    publishKernelSyncApi({ call: (method) => (method === 'process.reserve' ? 7 : null) });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    const events: string[] = [];
    owner.on('exit', (_code, signal) => events.push(`exit:${String(signal)}`));
    owner.on('close', (_code, signal) => events.push(`close:${String(signal)}`));
    manager.reserveForwardedProcess(41, 'node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(41, owner.pid);

    Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
    const microtasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => microtasks.push(task));
    expect(owner.kill()).toBe(true);
    expect(sealWorkerOutput(initOf(worker).spec.outputState)).toBe(true);
    worker.fire('message', attestedExit(worker, 0) as unknown as MessageEvent);
    const failure = drainCapturedMicrotasks(microtasks);

    expect(String(failure)).toMatch(/process\.peer-death.*upstream authority/u);
    expect(events).toEqual(['exit:SIGTERM', 'close:SIGTERM']);
    expect(owner.signalCode).toBe('SIGTERM');
    expect(manager.get(owner.pid)).toBeNull();
    expect(manager.list()).toEqual([]);
    expect(owner.kill()).toBe(false);
  });

  it('aggregates independent upstream teardown failures after local close', async () => {
    let failUpstream = false;
    publishKernelSyncApi({
      call(method) {
        if (method === 'process.reserve') return 7;
        if (failUpstream) throw new Error(`${method}: injected upstream failure`);
        return null;
      },
    });
    const manager = new ProcessManager();
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const owner = manager.spawnWorker('node', workerSpec('owner'), 1, { federated: true });
    let closes = 0;
    owner.on('close', () => closes++);
    manager.reserveForwardedProcess(41, 'node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(41, owner.pid);
    failUpstream = true;

    const microtasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => microtasks.push(task));
    expect(owner.kill()).toBe(true);
    expect(sealWorkerOutput(initOf(worker).spec.outputState)).toBe(true);
    worker.fire('message', attestedExit(worker, 0) as unknown as MessageEvent);
    const failure = drainCapturedMicrotasks(microtasks);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error) => String(error))).toEqual([
      expect.stringMatching(/process\.peer-death.*injected upstream failure/u),
      expect.stringMatching(/process\.settle.*injected upstream failure/u),
    ]);
    expect(closes).toBe(1);
    expect(manager.list()).toEqual([]);
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
    expect(thread.kill()).toBe(true);
    expect(
      await callProcessRpc(caller, 'process.settle', {
        pid: childPid,
        code: null,
        signal: 'SIGTERM',
      }),
    ).toEqual({ ok: true, value: null });
    await vi.waitFor(() =>
      expect(manager.snapshot()).not.toContainEqual({
        pid: childPid,
        ppid: process.pid,
        command: 'node',
      }),
    );
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
      terminal: 'control:self-exit',
      trigger(port: MessagePort) {
        port.dispatchEvent(
          new MessageEvent('message', { data: { kind: 'control:self-exit', code: 7 } }),
        );
      },
    },
  ])('drains admitted stdout before $terminal settles the Worker', async ({ trigger }) => {
    const worker = new BoundaryWorker();
    setWorkerFactoryForTests(() => worker);
    const manager = new ProcessManager();
    const child = manager.spawnWorker('node', workerSpec('late-stdout'));
    if (child.kind !== 'worker') throw new Error('expected worker handle');
    const chunks: string[] = [];
    child.stdout().on('data', (chunk: unknown) => {
      chunks.push(new TextDecoder().decode(chunk as Uint8Array));
    });

    const stdio = initOf(worker).spec.stdio;
    bindDesiredWorkerStdioOutput(
      stdio.stdout,
      initOf(worker).spec.outputState,
      'stdout',
      stdio.ipc,
    ).write(new TextEncoder().encode('late\n'));
    trigger(child.ports.ipc);
    await vi.waitFor(() => expect(child.exitCode).toBe(7));
    expect(chunks.join('')).toBe('late\n');
    expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]);
  });

  it('keeps remote descendants published until a killed physical owner receives settle proof', async () => {
    const manager = new ProcessManager();
    setWorkerFactoryForTests(() => new BoundaryWorker());
    const owner = manager.spawnWorker('nodemon', workerSpec('nodemon'));
    const pid = manager.reserveRemoteProcess('node', owner.pid, '/workspace', owner.pid);
    manager.commitRemoteProcess(pid, owner.pid);

    expect(owner.kill()).toBe(true);
    expect(manager.snapshot()).toContainEqual({ pid, ppid: owner.pid, command: 'node' });
    manager.settleRemoteProcess(pid, owner.pid, null, 'SIGTERM');

    await vi.waitFor(() =>
      expect(manager.snapshot()).toEqual([{ pid: 1, ppid: 0, command: 'rifty' }]),
    );
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
