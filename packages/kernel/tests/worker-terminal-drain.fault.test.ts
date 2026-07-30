import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProcessManager,
  type WorkerProcessHandle,
  decodeIpcFrame,
} from '../src/process-manager.ts';
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
import * as workerStdioDrain from '../src/worker-stdio-drain.ts';
import {
  bindWorkerStdioOutput,
  createWorkerOutputState,
  cutWorkerOutput,
  sealWorkerOutput,
  workerOutputAttestation,
} from '../src/worker-stdio-drain.ts';
import { attestedExit } from './attested-exit.ts';

const MAX_CHUNKS = 0x7fffffff;
const TOTAL_CHUNK_CEILING = MAX_CHUNKS * 2;
type WorkerListener = (event: MessageEvent) => void;
type WorkerOutputName = 'stdout' | 'stderr';

interface DesiredWorkerOutputTargets {
  readonly stdout: number;
  readonly stderr: number;
}

interface DesiredWorkerOutputReceiver {
  acceptOrderFrame(frame: unknown): void;
  cut(targets: DesiredWorkerOutputTargets): void;
  abandon(): void;
}

interface DesiredWorkerOutputReceiverEvents {
  onChunk(stream: WorkerOutputName, bytes: Uint8Array): void;
  onDrained(): void;
  onProtocolError(error: Error): void;
}

interface TrustedOrderFrame {
  readonly kind: 'control:stdio-order';
  readonly stream: WorkerOutputName;
  readonly order: number;
  readonly attestation: string;
}

type BindWorkerStdioOutputReceiver = (
  ports: Readonly<{ stdout: MessagePort; stderr: MessagePort }>,
  state: ReturnType<typeof createWorkerOutputState>,
  events: DesiredWorkerOutputReceiverEvents,
) => DesiredWorkerOutputReceiver;

function bindDesiredWorkerOutputReceiver(
  ports: Readonly<{ stdout: MessagePort; stderr: MessagePort }>,
  state: ReturnType<typeof createWorkerOutputState>,
  events: DesiredWorkerOutputReceiverEvents,
): DesiredWorkerOutputReceiver {
  const bind = (
    workerStdioDrain as unknown as {
      readonly bindWorkerStdioOutputReceiver?: BindWorkerStdioOutputReceiver;
    }
  ).bindWorkerStdioOutputReceiver;
  if (typeof bind !== 'function') {
    throw new Error('ADR-0338 RED: bindWorkerStdioOutputReceiver is not implemented');
  }
  return bind(ports, state, events);
}

type DesiredBindWorkerStdioOutput = (
  outputPort: MessagePort,
  state: ReturnType<typeof createWorkerOutputState>,
  stream: WorkerOutputName,
  controlPort: MessagePort,
) => ReturnType<typeof bindWorkerStdioOutput>;

function bindDesiredWorkerStdioOutput(
  outputPort: MessagePort,
  state: ReturnType<typeof createWorkerOutputState>,
  stream: WorkerOutputName,
  controlPort: MessagePort,
): ReturnType<typeof bindWorkerStdioOutput> {
  return (bindWorkerStdioOutput as unknown as DesiredBindWorkerStdioOutput)(
    outputPort,
    state,
    stream,
    controlPort,
  );
}

interface OrderedReceiverSubject {
  readonly state: ReturnType<typeof createWorkerOutputState>;
  readonly stdout: MessageChannel;
  readonly stderr: MessageChannel;
  readonly chunks: string[];
  readonly errors: Error[];
  readonly receiver: DesiredWorkerOutputReceiver;
  readonly drained: { count: number };
}

function orderedReceiverSubject(state = createWorkerOutputState()): OrderedReceiverSubject {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const chunks: string[] = [];
  const errors: Error[] = [];
  const drained = { count: 0 };
  const receiver = bindDesiredWorkerOutputReceiver(
    { stdout: stdout.port1, stderr: stderr.port1 },
    state,
    {
      onChunk: (stream, bytes) => chunks.push(`${stream}:${new TextDecoder().decode(bytes)}`),
      onDrained: () => drained.count++,
      onProtocolError: (error) => errors.push(error),
    },
  );
  return { state, stdout, stderr, chunks, errors, receiver, drained };
}

function trustedOrderFrame(
  state: ReturnType<typeof createWorkerOutputState>,
  stream: WorkerOutputName,
  order: number,
): TrustedOrderFrame {
  return {
    kind: 'control:stdio-order',
    stream,
    order,
    attestation: workerOutputAttestation(state),
  };
}

function cutWithUnknownTargets(receiver: DesiredWorkerOutputReceiver, targets: unknown): void {
  (receiver.cut as unknown as (targets: unknown) => void)(targets);
}

async function deliverRawOutput(
  subject: OrderedReceiverSubject,
  stream: WorkerOutputName,
  frame: unknown,
): Promise<void> {
  const channel = subject[stream];
  const delivered = new Promise<void>((resolve) => {
    channel.port1.addEventListener('message', () => resolve(), { once: true });
  });
  channel.port2.postMessage(frame);
  await delivered;
}

function expectReceiverProtocolFailure(
  subject: OrderedReceiverSubject,
  expectedChunks: readonly string[] = [],
): void {
  expect(subject.chunks).toEqual(expectedChunks);
  expect(subject.drained.count).toBe(0);
  expect(subject.errors).toHaveLength(1);
  expect(subject.errors[0]).toBeInstanceOf(Error);
}

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

  it('reports corrupt output control while abrupt worker death still settles', async () => {
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
    const words = new Int32Array(subject.init.spec.outputState);
    Atomics.store(words, 0, 41);
    Atomics.store(words, 1, 7);

    subject.worker.fireError('worker died with corrupt output state');
    await closed;

    expect(events).toEqual([
      'stderr:worker died with corrupt output state\n' +
        'Worker output state has invalid phase 41 and active value 7\n',
      'exit:1/null',
      'close:1/null',
    ]);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('turns corrupt output control on private peer-close into a finite loud failure', async () => {
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
    const words = new Int32Array(subject.init.spec.outputState);
    Atomics.store(words, 0, 41);
    Atomics.store(words, 1, 7);

    subject.init.spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });
    expect(await closesWithin(closed)).toBe('closed');

    expect(events).toEqual([
      'stderr:Worker output state has invalid phase 41 and active value 7\n',
      'exit:1/null',
      'close:1/null',
    ]);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
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

    bindDesiredWorkerStdioOutput(
      subject.init.spec.stdio.stderr,
      subject.init.spec.outputState,
      'stderr',
      subject.init.spec.stdio.ipc,
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
    bindDesiredWorkerStdioOutput(
      subject.init.spec.stdio.stdout,
      subject.init.spec.outputState,
      'stdout',
      subject.init.spec.stdio.ipc,
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
    expect(observed.events).toHaveLength(4);
    expect(observed.events[0]).toBe('stdout:last-output');
    expect(observed.events).toContain('stdout:end');
    expect(observed.events).toContain('exit:1/null');
    expect(observed.events).toContain('close:1/null');
    expect(observed.events.indexOf('stdout:end')).toBeLessThan(
      observed.events.indexOf('close:1/null'),
    );
    expect(observed.events.indexOf('exit:1/null')).toBeLessThan(
      observed.events.indexOf('close:1/null'),
    );
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
    subject.worker.fire('message', attestedExit(subject.worker, 0) as unknown as MessageEvent);
    subject.worker.fire('message', attestedExit(subject.worker, 0) as unknown as MessageEvent);

    await observed.closed;

    expect(observed.events).toEqual(['exit:0/null', 'close:0/null']);
    expect(subject.handle.exitCode).toBe(0);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('keeps the first child-sealed terminal code and settles exactly once', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const observed = observeTerminal(subject.handle);
    bindDesiredWorkerStdioOutput(
      subject.init.spec.stdio.stdout,
      subject.init.spec.outputState,
      'stdout',
      subject.init.spec.stdio.ipc,
    ).write(new TextEncoder().encode('queued-before-exit'));

    sealWorkerOutput(subject.init.spec.outputState);
    subject.worker.fire('message', attestedExit(subject.worker, 7) as unknown as MessageEvent);
    subject.worker.fire('message', attestedExit(subject.worker, 0) as unknown as MessageEvent);

    await observed.closed;

    expect(observed.events).toEqual(['exit:7/null', 'close:7/null']);
    expect(subject.handle.exitCode).toBe(7);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('ProcessManager restores authenticated cross-stream order before terminal drain', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const childStdout = subject.init.spec.stdio.stdout;
    const childStderr = subject.init.spec.stdio.stderr;
    const childControl = subject.init.spec.stdio.ipc;
    const nativeStdoutPost = childStdout.postMessage.bind(childStdout);
    const nativeStderrPost = childStderr.postMessage.bind(childStderr);
    const nativeControlPost = childControl.postMessage.bind(childControl);
    const capturedStdout: unknown[] = [];
    const capturedStderr: unknown[] = [];
    const capturedOrder: unknown[] = [];
    const userMessages: unknown[] = [];
    subject.handle.on('message', (message) => userMessages.push(message));
    Object.defineProperty(childStdout, 'postMessage', {
      configurable: true,
      value: (frame: unknown) => capturedStdout.push(frame),
    });
    Object.defineProperty(childStderr, 'postMessage', {
      configurable: true,
      value: (frame: unknown) => capturedStderr.push(frame),
    });
    Object.defineProperty(childControl, 'postMessage', {
      configurable: true,
      value: (frame: unknown) => capturedOrder.push(frame),
    });

    const stdout = bindDesiredWorkerStdioOutput(
      childStdout,
      subject.init.spec.outputState,
      'stdout',
      childControl,
    );
    const stderr = bindDesiredWorkerStdioOutput(
      childStderr,
      subject.init.spec.outputState,
      'stderr',
      childControl,
    );
    stdout.write(new TextEncoder().encode('out-0'));
    stderr.write(new TextEncoder().encode('err-1'));
    stdout.write(new TextEncoder().encode('out-2'));
    expect(capturedStdout).toStrictEqual([
      new TextEncoder().encode('out-0'),
      new TextEncoder().encode('out-2'),
    ]);
    expect(capturedStderr).toStrictEqual([new TextEncoder().encode('err-1')]);

    const events: string[] = [];
    subject.handle.stdout().on('data', (chunk: unknown) => {
      events.push(`stdout:${decodeOutputChunk(chunk)}`);
    });
    subject.handle.stderr().on('data', (chunk: unknown) => {
      events.push(`stderr:${decodeOutputChunk(chunk)}`);
    });
    subject.handle.stdout().on('end', () => events.push('stdout:end'));
    subject.handle.stderr().on('end', () => events.push('stderr:end'));
    subject.handle.on('exit', (code, signal) => {
      events.push(`exit:${String(code)}/${String(signal)}`);
    });
    const closed = new Promise<void>((resolve) => {
      subject.handle.on('close', (code, signal) => {
        events.push(`close:${String(code)}/${String(signal)}`);
        resolve();
      });
    });

    const deliver = async (
      receiver: MessagePort,
      post: (frame: unknown) => void,
      frame: unknown,
    ): Promise<void> => {
      const arrived = new Promise<void>((resolve) => {
        receiver.addEventListener('message', () => resolve(), { once: true });
      });
      post(frame);
      await arrived;
    };

    expect.soft(capturedOrder).toHaveLength(3);
    if (capturedOrder.length !== 3) {
      subject.worker.fireError('ADR-0338 expected RED cleanup');
      await closed;
      return;
    }

    expect(sealWorkerOutput(subject.init.spec.outputState)).toBe(true);
    subject.worker.fire('message', attestedExit(subject.worker, 0));
    expect(events).toEqual([]);

    await deliver(subject.handle.ports.stderr, nativeStderrPost, capturedStderr[0]);
    expect.soft(events).toEqual([]);
    await deliver(subject.handle.ports.stdout, nativeStdoutPost, capturedStdout[0]);
    expect.soft(events).toEqual([]);
    await deliver(subject.handle.ports.stdout, nativeStdoutPost, capturedStdout[1]);
    expect.soft(events).toEqual([]);
    await deliver(subject.handle.ports.ipc, nativeControlPost, capturedOrder[0]);
    expect.soft(events).toEqual(['stdout:out-0']);
    expect(userMessages).toEqual([]);
    await deliver(subject.handle.ports.ipc, nativeControlPost, capturedOrder[1]);
    expect(userMessages).toEqual([]);
    expect.soft(events).toEqual(['stdout:out-0', 'stderr:err-1']);
    await deliver(subject.handle.ports.ipc, nativeControlPost, capturedOrder[2]);
    await closed;

    const dataEvents = events.filter((event) => !event.endsWith(':end'));
    expect(dataEvents).toEqual([
      'stdout:out-0',
      'stderr:err-1',
      'stdout:out-2',
      'exit:0/null',
      'close:0/null',
    ]);
    const exitIndex = events.indexOf('exit:0/null');
    const closeIndex = events.indexOf('close:0/null');
    expect(exitIndex).toBeGreaterThan(events.indexOf('stdout:out-2'));
    expect(events.indexOf('stdout:end')).toBeLessThan(closeIndex);
    expect(events.indexOf('stderr:end')).toBeLessThan(closeIndex);
    expect(closeIndex).toBe(events.length - 1);
    expect(subject.handle.exitCode).toBe(0);
    expect(userMessages).toEqual([]);
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
  });

  it('abandons a poisoned raw-without-witness suffix and settles physical death finitely', async () => {
    const subject = spawnSubject(new BoundaryWorker());
    const events: string[] = [];
    subject.handle.stdout().on('data', (chunk: unknown) => {
      events.push(`stdout:${decodeOutputChunk(chunk)}`);
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
    const failedControl = {
      postMessage() {
        throw new Error('injected order witness post failure');
      },
    } as unknown as MessagePort;
    const writer = bindDesiredWorkerStdioOutput(
      subject.init.spec.stdio.stdout,
      subject.init.spec.outputState,
      'stdout',
      failedControl,
    );

    let writeFailure: Error | undefined;
    try {
      writer.write(new TextEncoder().encode('orphan'));
    } catch (error) {
      writeFailure = error instanceof Error ? error : new Error(String(error));
    }
    expect.soft(writeFailure?.message).toBe('injected order witness post failure');
    if (writeFailure === undefined) {
      subject.worker.fireError('ADR-0338 expected RED cleanup');
      await closed;
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(events).toEqual([]);

    subject.worker.fireError('worker died after torn output');

    expect(await closesWithin(closed)).toBe('closed');
    expect(events.some((event) => event.startsWith('stdout:'))).toBe(false);
    expect(events).toContain('exit:1/null');
    expect(events).toContain('close:1/null');
    expect(subject.manager.get(subject.handle.pid)).toBeNull();
    expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
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

  it.each(['stdout', 'ipc'] as const)(
    'turns %s-port messageerror into one loud terminal failure',
    async (port) => {
      const subject = spawnSubject(new BoundaryWorker());
      const observed = observeTerminal(subject.handle);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const userMessages: unknown[] = [];
      subject.handle.stdout().on('data', (chunk) => stdout.push(decodeOutputChunk(chunk)));
      subject.handle.stderr().on('data', (chunk) => stderr.push(decodeOutputChunk(chunk)));
      subject.handle.on('message', (message) => userMessages.push(message));

      subject.handle.ports[port].dispatchEvent(
        new MessageEvent('messageerror', { data: 'injected deserialize failure' }),
      );

      const winner = await closesWithin(observed.closed);

      expect.soft(winner).toBe('closed');
      expect(observed.events).toEqual(['exit:1/null', 'close:1/null']);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([
        port === 'stdout'
          ? 'Worker stdio failed to deserialize a frame\n'
          : 'Worker process-control port failed to deserialize a frame\n',
      ]);
      expect(userMessages).toEqual([]);
      expect(subject.handle.exitCode).toBe(1);
      expect(subject.manager.get(subject.handle.pid)).toBeNull();
      expect(subject.worker.terminate).toHaveBeenCalledTimes(1);
    },
  );
});

describe('Worker ordered-output receiver fault matrix', () => {
  it.each(['non-record', 'missing order', 'extra field'] as const)(
    'rejects a malformed non-exact order witness: %s',
    (fault) => {
      const subject = orderedReceiverSubject();
      const trusted = trustedOrderFrame(subject.state, 'stdout', 0) as {
        readonly kind: 'control:stdio-order';
        readonly stream: 'stdout';
        readonly order: number;
        readonly attestation: string;
      };
      const frame =
        fault === 'non-record'
          ? new Uint8Array([1])
          : fault === 'missing order'
            ? {
                kind: trusted.kind,
                stream: trusted.stream,
                attestation: trusted.attestation,
              }
            : { ...trusted, extra: true };

      subject.receiver.acceptOrderFrame(frame);

      expectReceiverProtocolFailure(subject);
    },
  );

  it.each([
    ['kind', 'missing'],
    ['kind', 'wrong type'],
    ['kind', 'wrong value'],
    ['stream', 'missing'],
    ['stream', 'wrong type'],
    ['stream', 'wrong value'],
  ] as const)('rejects an order witness with %s %s', (field, fault) => {
    const subject = orderedReceiverSubject();
    const frame: Record<string, unknown> = {
      ...trustedOrderFrame(subject.state, 'stdout', 0),
    };
    if (fault === 'missing') {
      delete frame[field];
    } else if (fault === 'wrong type') {
      frame[field] = 41;
    } else {
      frame[field] = field === 'kind' ? 'control:not-stdio-order' : 'stdin';
    }

    subject.receiver.acceptOrderFrame(frame);

    expectReceiverProtocolFailure(subject);
  });

  it.each([
    ['wrong type', '0'],
    ['negative', -1],
    ['non-integer', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['at total ceiling', TOTAL_CHUNK_CEILING],
    ['above total ceiling', TOTAL_CHUNK_CEILING + 1],
  ])('rejects a %s authenticated output order', (_label, order) => {
    const subject = orderedReceiverSubject();
    const frame = {
      kind: 'control:stdio-order',
      stream: 'stdout',
      order,
      attestation: workerOutputAttestation(subject.state),
    };

    subject.receiver.acceptOrderFrame(frame);

    expectReceiverProtocolFailure(subject);
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-attestation'],
  ])('rejects %s order-witness provenance', (_label, attestation) => {
    const subject = orderedReceiverSubject();
    const frame =
      attestation === undefined
        ? { kind: 'control:stdio-order', stream: 'stdout', order: 0 }
        : { kind: 'control:stdio-order', stream: 'stdout', order: 0, attestation };

    subject.receiver.acceptOrderFrame(frame);

    expectReceiverProtocolFailure(subject);
  });

  it('rejects a wrong-type attestation even when string coercion yields the secret', () => {
    const subject = orderedReceiverSubject();
    const attestation = {
      toString: () => workerOutputAttestation(subject.state),
    };

    subject.receiver.acceptOrderFrame({
      kind: 'control:stdio-order',
      stream: 'stdout',
      order: 0,
      attestation,
    });

    expectReceiverProtocolFailure(subject);
  });

  it('accepts the exact witness produced by a trusted writer', async () => {
    const state = createWorkerOutputState();
    const subject = orderedReceiverSubject(state);
    const rawFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    const rawPort = {
      postMessage(frame: unknown) {
        rawFrames.push(frame);
      },
    } as unknown as MessagePort;
    const controlPort = {
      postMessage(frame: unknown) {
        orderFrames.push(frame);
      },
    } as unknown as MessagePort;
    const writer = bindDesiredWorkerStdioOutput(rawPort, state, 'stdout', controlPort);

    writer.write(new TextEncoder().encode('trusted'));
    expect(orderFrames).toHaveLength(1);
    const decoded = decodeIpcFrame(orderFrames[0]);
    expect(decoded).toStrictEqual(orderFrames[0]);
    subject.receiver.acceptOrderFrame(decoded);
    await deliverRawOutput(subject, 'stdout', rawFrames[0]);

    expect(subject.chunks).toEqual(['stdout:trusted']);
    expect(subject.errors).toEqual([]);
  });

  it.each([
    ['string', 'not-bytes'],
    ['record', { bytes: true }],
  ])('rejects raw output bytes with the wrong type: %s', async (_label, frame) => {
    const subject = orderedReceiverSubject();

    await deliverRawOutput(subject, 'stdout', frame);

    expectReceiverProtocolFailure(subject);
  });

  it('rejects a duplicate order while the original witness is buffered', () => {
    const subject = orderedReceiverSubject();
    const frame = trustedOrderFrame(subject.state, 'stdout', 0);

    subject.receiver.acceptOrderFrame(frame);
    expect(subject.errors).toEqual([]);
    subject.receiver.acceptOrderFrame(frame);

    expectReceiverProtocolFailure(subject);
  });

  it('rejects a stale order after its frame was emitted', async () => {
    const subject = orderedReceiverSubject();
    const frame = trustedOrderFrame(subject.state, 'stdout', 0);

    subject.receiver.acceptOrderFrame(frame);
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('emitted'));
    expect(subject.chunks).toEqual(['stdout:emitted']);
    subject.receiver.acceptOrderFrame(frame);

    expectReceiverProtocolFailure(subject, ['stdout:emitted']);
  });

  it('rejects a cross-stream collision on one buffered order', () => {
    const subject = orderedReceiverSubject();

    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
    expect(subject.errors).toEqual([]);
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stderr', 0));

    expectReceiverProtocolFailure(subject);
  });

  it('rejects an order witness gap', async () => {
    const subject = orderedReceiverSubject();

    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('first'));
    expect(subject.chunks).toEqual(['stdout:first']);
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 2));

    expectReceiverProtocolFailure(subject, ['stdout:first']);
  });

  it.each(['non-record', 'missing stream', 'extra field'] as const)(
    'rejects malformed terminal cut targets: %s',
    (fault) => {
      const subject = orderedReceiverSubject();
      const targets =
        fault === 'non-record'
          ? null
          : fault === 'missing stream'
            ? { stdout: 0 }
            : { stdout: 0, stderr: 0, extra: true };

      cutWithUnknownTargets(subject.receiver, targets);

      expectReceiverProtocolFailure(subject);
    },
  );

  it.each([
    ['stdout', 'wrong type', '0'],
    ['stdout', 'negative', -1],
    ['stdout', 'non-integer', 0.5],
    ['stdout', 'NaN', Number.NaN],
    ['stdout', 'Infinity', Number.POSITIVE_INFINITY],
    ['stdout', 'unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['stdout', 'above per-stream maximum', MAX_CHUNKS + 1],
    ['stderr', 'wrong type', '0'],
    ['stderr', 'negative', -1],
    ['stderr', 'non-integer', 0.5],
    ['stderr', 'NaN', Number.NaN],
    ['stderr', 'Infinity', Number.POSITIVE_INFINITY],
    ['stderr', 'unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['stderr', 'above per-stream maximum', MAX_CHUNKS + 1],
  ] as const)('rejects a %s cut target with a %s value', (stream, _fault, value) => {
    const subject = orderedReceiverSubject();
    const targets: Record<WorkerOutputName, unknown> = { stdout: 0, stderr: 0 };
    targets[stream] = value;

    cutWithUnknownTargets(subject.receiver, targets);

    expectReceiverProtocolFailure(subject);
  });

  it('rejects per-stream target mismatch even when the aggregate target matches', async () => {
    const subject = orderedReceiverSubject();

    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('stdout'));
    expect(subject.chunks).toEqual(['stdout:stdout']);
    subject.receiver.cut({ stdout: 0, stderr: 1 });

    expectReceiverProtocolFailure(subject, ['stdout:stdout']);
  });

  it('rejects a raw/witness stream-count mismatch under an immutable target', async () => {
    const subject = orderedReceiverSubject();

    subject.receiver.cut({ stdout: 1, stderr: 0 });
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
    await deliverRawOutput(subject, 'stderr', new TextEncoder().encode('wrong-stream'));

    expectReceiverProtocolFailure(subject);
  });

  it('rejects a changed second terminal cut', () => {
    const subject = orderedReceiverSubject();

    subject.receiver.cut({ stdout: 1, stderr: 0 });
    expect(subject.errors).toEqual([]);
    subject.receiver.cut({ stdout: 0, stderr: 1 });

    expectReceiverProtocolFailure(subject);
  });

  it.each(['raw', 'witness'] as const)(
    'keeps normal cut pending without the matching %s evidence',
    async (missing) => {
      const subject = orderedReceiverSubject();

      if (missing === 'raw') {
        subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
      } else {
        await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('unmatched'));
      }
      subject.receiver.cut({ stdout: 1, stderr: 0 });

      expect(subject.chunks).toEqual([]);
      expect(subject.drained.count).toBe(0);
      expect(subject.errors).toEqual([]);
    },
  );

  it.each(['raw', 'witness'] as const)(
    'rejects a pre-cut buffered %s count above the immutable target',
    async (buffered) => {
      const subject = orderedReceiverSubject();

      if (buffered === 'raw') {
        await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('first'));
        await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('second'));
      } else {
        subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
        subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 1));
      }
      subject.receiver.cut({ stdout: 1, stderr: 0 });

      expectReceiverProtocolFailure(subject);
    },
  );

  it('rejects a raw output overrun after a completed zero-target cut', async () => {
    const subject = orderedReceiverSubject();

    subject.receiver.cut({ stdout: 0, stderr: 0 });
    expect(subject.drained.count).toBe(1);
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('overrun'));

    expect(subject.chunks).toEqual([]);
    expect(subject.drained.count).toBe(1);
    expect(subject.errors).toHaveLength(1);
    expect(subject.errors[0]).toBeInstanceOf(Error);
  });

  it('rejects an authenticated witness overrun after a completed zero-target cut', () => {
    const subject = orderedReceiverSubject();

    subject.receiver.cut({ stdout: 0, stderr: 0 });
    expect(subject.drained.count).toBe(1);
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));

    expect(subject.chunks).toEqual([]);
    expect(subject.drained.count).toBe(1);
    expect(subject.errors).toHaveLength(1);
    expect(subject.errors[0]).toBeInstanceOf(Error);
  });

  it('abandons a buffered suffix without drain or error and ignores a later gap fill', async () => {
    const subject = orderedReceiverSubject();

    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 0));
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stderr', 1));
    subject.receiver.acceptOrderFrame(trustedOrderFrame(subject.state, 'stdout', 2));
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('prefix'));
    await deliverRawOutput(subject, 'stdout', new TextEncoder().encode('buffered-suffix'));
    expect(subject.chunks).toEqual(['stdout:prefix']);

    subject.receiver.abandon();
    const lateDelivery = new Promise<void>((resolve) => {
      subject.stderr.port1.addEventListener('message', () => resolve(), { once: true });
    });
    subject.stderr.port2.postMessage(new TextEncoder().encode('late-gap-fill'));
    await Promise.race([
      lateDelivery,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      }),
    ]);

    expect(subject.chunks).toEqual(['stdout:prefix']);
    expect(subject.drained.count).toBe(0);
    expect(subject.errors).toEqual([]);
  });
});
