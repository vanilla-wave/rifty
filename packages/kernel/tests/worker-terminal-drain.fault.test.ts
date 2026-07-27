import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager, type WorkerProcessHandle } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';
import {
  type WorkerSpawnSpec,
  finalizeWorkerEntry,
  installWorkerPeerCloseAttestation,
} from '../src/worker-entry.ts';
import {
  bindWorkerStdioOutput,
  cutWorkerOutput,
  sealWorkerOutput,
} from '../src/worker-stdio-drain.ts';

type WorkerListener = (event: MessageEvent) => void;

class BoundaryWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn();
  readonly #listeners = new Map<string, Set<WorkerListener>>();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  fire(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data });
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }

  fireError(message: string): void {
    const event = { message } as unknown as MessageEvent;
    for (const listener of [...(this.#listeners.get('error') ?? [])]) listener(event);
  }
}

interface CapturedInit {
  readonly spec: WorkerSpawnSpec;
}

interface Subject {
  readonly manager: ProcessManager;
  readonly handle: WorkerProcessHandle;
  readonly worker: BoundaryWorker;
  readonly init: CapturedInit;
}

function spawnSubject(worker: BoundaryWorker, serve = true): Subject {
  setWorkerFactoryForTests(() => worker);
  const manager = new ProcessManager();
  const handle = manager.spawnWorker('terminal-drain-fault', {
    entry: {
      kind: 'source',
      code: 'void 0;',
      sourceUrl: '/terminal-drain-fault.js',
    },
    argv: ['terminal-drain-fault'],
    env: {},
    cwd: '/workspace',
    serve,
  });
  if (handle.kind !== 'worker') throw new Error('expected Worker process handle');
  const init = worker.posted[0] as CapturedInit;
  return { manager, handle, worker, init };
}

function observeTerminal(handle: WorkerProcessHandle): {
  readonly closed: Promise<void>;
  readonly events: string[];
} {
  const events: string[] = [];
  handle.on('peererror', () => events.push('peererror'));
  handle.on('exit', (code, signal) => events.push(`exit:${String(code)}/${String(signal)}`));
  const closed = new Promise<void>((resolve) => {
    handle.on('close', (code, signal) => {
      events.push(`close:${String(code)}/${String(signal)}`);
      resolve();
    });
  });
  return { closed, events };
}

async function closesWithin(closed: Promise<void>, timeoutMs = 50): Promise<'closed' | 'timeout'> {
  return await Promise.race([
    closed.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    }),
  ]);
}

function decodeOutputChunk(chunk: unknown): string {
  if (!(chunk instanceof Uint8Array)) throw new TypeError('expected Uint8Array output');
  return new TextDecoder().decode(chunk);
}

describe('Worker terminal drain fault matrix', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    vi.restoreAllMocks();
  });

  it('settles abrupt peer death once when its one process-wide active write is stranded', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    const words = new Int32Array(subject.init.spec.outputState);

    // Fault injection at the SAB boundary: the producer died after claiming
    // admission but before commit/finally. A dead peer can never clear this
    // process-wide active claim, so peererror must abandon it rather than wait.
    Atomics.store(words, 1, 1);
    subject.init.spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });

    const winner = await closesWithin(observed.closed);

    expect.soft(winner).toBe('closed');
    expect(observed.events).toEqual(['peererror', 'close:null/null']);
    expect(subject.handle.exitCode).toBeNull();
    expect(subject.handle.signalCode).toBeNull();
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('preserves an accepted signal when abrupt worker death strands its active write', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    const words = new Int32Array(subject.init.spec.outputState);
    Atomics.store(words, 1, 1);

    expect(subject.handle.kill('SIGTERM')).toBe(true);
    subject.worker.fire('error', new Error('worker died during output'));

    const winner = await closesWithin(observed.closed);

    expect.soft(winner).toBe('closed');
    expect(observed.events).toEqual(['exit:null/SIGTERM', 'close:null/SIGTERM']);
    expect(subject.handle.signalCode).toBe('SIGTERM');
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('releases a pending output waiter when unsealed death abandons an accepted signal', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    const words = new Int32Array(subject.init.spec.outputState);
    const atomics = Atomics as unknown as {
      waitAsync(
        words: Int32Array,
        index: number,
        value: number,
      ): {
        readonly async: boolean;
        readonly value: Promise<'ok' | 'timed-out'> | 'not-equal';
      };
    };
    const nativeWaitAsync = atomics.waitAsync.bind(Atomics);
    let pendingWaiters = 0;
    let allWaitersReleased: (() => void) | undefined;
    const waitersReleased = new Promise<void>((resolve) => {
      allWaitersReleased = resolve;
    });
    vi.spyOn(atomics, 'waitAsync').mockImplementation((words, index, value) => {
      const waiting = nativeWaitAsync(words, index, value);
      if (!waiting.async) return waiting;
      pendingWaiters++;
      return {
        async: true,
        value: (waiting.value as Promise<'ok' | 'timed-out'>).finally(() => {
          pendingWaiters--;
          if (pendingWaiters === 0) allWaitersReleased?.();
        }),
      };
    });

    Atomics.store(words, 1, 1);

    expect(subject.handle.kill('SIGTERM')).toBe(true);
    expect(pendingWaiters).toBe(1);
    subject.worker.fireError('worker died during admitted output');

    expect(await closesWithin(observed.closed)).toBe('closed');
    const waiterState = await Promise.race([
      waitersReleased.then(() => 'released' as const),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 25);
      }),
    ]);

    expect(waiterState).toBe('released');
    expect(pendingWaiters).toBe(0);
    expect(Atomics.load(words, 1)).toBe(0);
    expect(observed.events).toEqual(['exit:null/SIGTERM', 'close:null/SIGTERM']);
  });

  it('settles an accepted signal when synchronous output-state validation fails', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    const words = new Int32Array(subject.init.spec.outputState);
    Atomics.store(words, 0, 99);

    expect(() => subject.handle.kill('SIGTERM')).not.toThrow();
    expect(await closesWithin(observed.closed)).toBe('closed');
    expect(observed.events).toEqual(['exit:null/SIGTERM', 'close:null/SIGTERM']);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('delivers a zero-child-output global-error diagnostic before terminal events', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const events: string[] = [];
    subject.handle.stderr().on('data', (chunk: unknown) => {
      events.push(`stderr:${decodeOutputChunk(chunk)}`);
    });
    subject.handle.on('exit', (code, signal) => {
      events.push(`exit:${String(code)}/${String(signal)}`);
    });
    const closed = new Promise<void>((resolve) => {
      subject.handle.on('close', (code, signal) => {
        events.push(`close:${String(code)}/${String(signal)}`);
        resolve();
      });
    });

    sealWorkerOutput(subject.init.spec.outputState);
    subject.worker.fireError('zero-output-global-error');
    await closed;
    await Promise.resolve();

    expect(events).toEqual(['stderr:zero-output-global-error\n', 'exit:1/null', 'close:1/null']);
  });

  it('keeps prior child stderr before the synthesized global-error diagnostic', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const events: string[] = [];
    subject.handle.stderr().on('data', (chunk: unknown) => {
      events.push(`stderr:${decodeOutputChunk(chunk)}`);
    });
    subject.handle.on('exit', (code, signal) => {
      events.push(`exit:${String(code)}/${String(signal)}`);
    });
    const closed = new Promise<void>((resolve) => {
      subject.handle.on('close', (code, signal) => {
        events.push(`close:${String(code)}/${String(signal)}`);
        resolve();
      });
    });

    bindWorkerStdioOutput(
      subject.init.spec.stdio.stderr,
      subject.init.spec.outputState,
      'stderr',
    ).write(new TextEncoder().encode('prior-child-stderr\n'));
    sealWorkerOutput(subject.init.spec.outputState);
    subject.worker.fireError('later-global-error');
    await closed;

    expect(events).toEqual([
      'stderr:prior-child-stderr\n',
      'stderr:later-global-error\n',
      'exit:1/null',
      'close:1/null',
    ]);
  });

  it('settles the parent when posting the sealed exit frame fails', async () => {
    const subject = spawnSubject(new BoundaryWorker(), false);
    const observed = observeTerminal(subject.handle);

    try {
      finalizeWorkerEntry(
        {
          postMessage() {
            throw new Error('injected sealed exit post failure');
          },
          close() {},
        },
        subject.init.spec,
        { threw: false, code: 0 },
      );
    } catch {
      // The child-side throw is independent of finite parent settlement.
    }

    expect(await closesWithin(observed.closed)).toBe('closed');
    expect(observed.events.filter((event) => event.startsWith('close:'))).toHaveLength(1);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('settles the parent when posting the sealed peer-close attestation fails', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    subject.handle.stdout().on('data', (chunk: unknown) => {
      observed.events.push(`stdout:${decodeOutputChunk(chunk)}`);
    });
    subject.handle.stdout().on('end', () => {
      observed.events.push('stdout:end');
    });
    bindWorkerStdioOutput(
      subject.init.spec.stdio.stdout,
      subject.init.spec.outputState,
      'stdout',
    ).write(new TextEncoder().encode('last-output'));
    Object.defineProperty(subject.init.spec.stdio.ipc, 'postMessage', {
      configurable: true,
      value() {
        throw new Error('injected peer-close attestation failure');
      },
    });
    const nativeClose = vi.fn();
    const target = {
      postMessage: (message: unknown) => subject.worker.fire('message', message),
      close: nativeClose,
    };
    installWorkerPeerCloseAttestation(target, subject.init.spec);

    expect(() => target.close()).not.toThrow();

    expect(await closesWithin(observed.closed)).toBe('closed');
    expect(observed.events).toEqual([
      'stdout:last-output',
      'stdout:end',
      'exit:1/null',
      'close:1/null',
    ]);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(nativeClose).toHaveBeenCalledTimes(1);
  });

  it('does not send a child terminal fallback after the parent already cut output', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    expect(cutWorkerOutput(subject.init.spec.outputState)).toEqual({
      stdout: 0,
      stderr: 0,
    });
    const postMessage = vi.fn();
    const nativeClose = vi.fn();
    const ipcPostMessage = vi.spyOn(subject.init.spec.stdio.ipc, 'postMessage');
    const target = { postMessage, close: nativeClose };
    installWorkerPeerCloseAttestation(target, subject.init.spec);

    target.close();

    expect(postMessage).not.toHaveBeenCalled();
    expect(ipcPostMessage).not.toHaveBeenCalled();
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(subject.handle.kill('SIGTERM')).toBe(true);
    await observed.closed;
  });

  it('closes the realm and throws when both sealed terminal transports fail', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    Object.defineProperty(subject.init.spec.stdio.ipc, 'postMessage', {
      configurable: true,
      value() {
        throw new Error('injected peer-close attestation failure');
      },
    });
    const nativeClose = vi.fn();
    const target = {
      postMessage() {
        throw new Error('injected global terminal failure');
      },
      close: nativeClose,
    };
    installWorkerPeerCloseAttestation(target, subject.init.spec);

    expect(() => target.close()).toThrow('injected global terminal failure');
    expect(nativeClose).toHaveBeenCalledTimes(1);

    subject.worker.fireError('physical worker death after both transports failed');
    expect(await closesWithin(observed.closed)).toBe('closed');
  });

  it('uses one child seal even when closing one raw output port fails', async () => {
    const subject = spawnSubject(new BoundaryWorker(), false);
    const observed = observeTerminal(subject.handle);
    const stdout = subject.init.spec.stdio.stdout;
    Object.defineProperty(stdout, 'close', {
      configurable: true,
      value() {
        throw new DOMException('injected stdout close failure', 'InvalidStateError');
      },
    });

    finalizeWorkerEntry(
      {
        postMessage: (message) => subject.worker.fire('message', message),
        close() {},
      },
      subject.init.spec,
      { threw: false, code: 0 },
    );

    const winner = await closesWithin(observed.closed);

    expect.soft(winner).toBe('closed');
    expect(observed.events.filter((event) => event.startsWith('close:'))).toHaveLength(1);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('treats an identical duplicate sealed exit as idempotent', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);

    sealWorkerOutput(subject.init.spec.outputState);
    subject.worker.fire('message', { type: 'exit', code: 0 });
    subject.worker.fire('message', { type: 'exit', code: 0 });

    await observed.closed;

    expect(observed.events).toEqual(['exit:0/null', 'close:0/null']);
    expect(subject.handle.exitCode).toBe(0);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('keeps the first child-sealed terminal code and settles exactly once', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    bindWorkerStdioOutput(
      subject.init.spec.stdio.stdout,
      subject.init.spec.outputState,
      'stdout',
    ).write(new TextEncoder().encode('queued-before-exit'));

    sealWorkerOutput(subject.init.spec.outputState);
    subject.worker.fire('message', { type: 'exit', code: 7 });
    subject.worker.fire('message', { type: 'exit', code: 0 });

    await observed.closed;

    expect(observed.events).toEqual(['exit:7/null', 'close:7/null']);
    expect(subject.handle.exitCode).toBe(7);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('fails a malformed output frame loudly without claiming drain', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    subject.init.spec.stdio.stdout.postMessage({ malformed: true });

    await observed.closed;

    expect(observed.events).toEqual(['exit:1/null', 'close:1/null']);
    expect(subject.handle.exitCode).toBe(1);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('turns output-port messageerror into one loud terminal failure', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);

    subject.handle.ports.stdout.dispatchEvent(
      new MessageEvent('messageerror', { data: 'injected deserialize failure' }),
    );

    const winner = await closesWithin(observed.closed);

    expect.soft(winner).toBe('closed');
    expect(observed.events).toEqual(['exit:1/null', 'close:1/null']);
    expect(subject.handle.exitCode).toBe(1);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
