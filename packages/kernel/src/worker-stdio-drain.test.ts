import { describe, expect, it, vi } from 'vitest';
import * as workerStdioDrain from './worker-stdio-drain.ts';
import {
  abandonWorkerOutput,
  bindWorkerStdioOutput,
  createWorkerOutputState,
  cutWorkerOutput,
  isWorkerOutputChildSealed,
  sealWorkerOutput,
  workerOutputAttestation,
} from './worker-stdio-drain.ts';

const MAX_CHUNKS = 0x7fffffff;
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
    throw new Error('ADR-0340 RED: bindWorkerStdioOutputReceiver is not implemented');
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

function recordingPort(messages: unknown[]): MessagePort {
  return {
    postMessage(message: unknown) {
      messages.push(message);
    },
  } as unknown as MessagePort;
}

async function deliverRawFrame(
  receiver: MessagePort,
  sender: MessagePort,
  frame: unknown,
): Promise<void> {
  const delivered = new Promise<void>((resolve) => {
    receiver.addEventListener('message', () => resolve(), { once: true });
  });
  sender.postMessage(frame);
  await delivered;
}

function receiveFrame(port: MessagePort): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for worker frame')), 250);
    port.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      },
      { once: true },
    );
    port.start();
  });
}

describe('Worker process-wide output cut', () => {
  it('counts byte writes per stream behind one child-sealed terminal phase', async () => {
    const state = createWorkerOutputState();
    const stdoutFrames: unknown[] = [];
    const stderrFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    const control = recordingPort(orderFrames);

    bindDesiredWorkerStdioOutput(recordingPort(stdoutFrames), state, 'stdout', control).write(
      new TextEncoder().encode('last'),
    );
    bindDesiredWorkerStdioOutput(recordingPort(stderrFrames), state, 'stderr', control).write(
      new Uint8Array([0x21]),
    );

    expect(sealWorkerOutput(state)).toBe(true);
    expect(isWorkerOutputChildSealed(state)).toBe(true);
    expect(await cutWorkerOutput(state)).toEqual({ stdout: 1, stderr: 1 });
    expect(stdoutFrames).toStrictEqual([new TextEncoder().encode('last')]);
    expect(stderrFrames).toStrictEqual([new Uint8Array([0x21])]);
    expect(orderFrames).toHaveLength(2);
  });

  it('restores order across raw-before-witness and legal cross-port delivery inversion', async () => {
    const state = createWorkerOutputState();
    const stdoutFrames: unknown[] = [];
    const stderrFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    const control = recordingPort(orderFrames);
    const stdout = bindDesiredWorkerStdioOutput(
      recordingPort(stdoutFrames),
      state,
      'stdout',
      control,
    );
    const stderr = bindDesiredWorkerStdioOutput(
      recordingPort(stderrFrames),
      state,
      'stderr',
      control,
    );

    stdout.write(new TextEncoder().encode('out-0'));
    stderr.write(new TextEncoder().encode('err-1'));
    stdout.write(new TextEncoder().encode('out-2'));
    expect(sealWorkerOutput(state)).toBe(true);
    const targets = await cutWorkerOutput(state);
    expect(targets).toEqual({ stdout: 2, stderr: 1 });

    const deliveredStdout = new MessageChannel();
    const deliveredStderr = new MessageChannel();
    const observed: string[] = [];
    const receiver = bindDesiredWorkerOutputReceiver(
      { stdout: deliveredStdout.port1, stderr: deliveredStderr.port1 },
      state,
      {
        onChunk: (stream, bytes) => observed.push(`${stream}:${new TextDecoder().decode(bytes)}`),
        onDrained: () => observed.push('drained'),
        onProtocolError: (error) => observed.push(`error:${error.message}`),
      },
    );
    receiver.cut(targets);

    await deliverRawFrame(deliveredStderr.port1, deliveredStderr.port2, stderrFrames[0]);
    expect(observed).toEqual([]);
    await deliverRawFrame(deliveredStdout.port1, deliveredStdout.port2, stdoutFrames[0]);
    expect(observed).toEqual([]);
    await deliverRawFrame(deliveredStdout.port1, deliveredStdout.port2, stdoutFrames[1]);
    expect(observed).toEqual([]);
    receiver.acceptOrderFrame(orderFrames[0]);
    expect(observed).toEqual(['stdout:out-0']);
    receiver.acceptOrderFrame(orderFrames[1]);
    expect(observed).toEqual(['stdout:out-0', 'stderr:err-1']);
    receiver.acceptOrderFrame(orderFrames[2]);

    expect(observed).toEqual(['stdout:out-0', 'stderr:err-1', 'stdout:out-2', 'drained']);
  });

  it('keeps raw ports byte-exact and writes exact authenticated order witnesses', () => {
    const state = createWorkerOutputState();
    const attestation = workerOutputAttestation(state);
    const stdoutFrames: unknown[] = [];
    const stderrFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    const control = recordingPort(orderFrames);
    const stdout = bindDesiredWorkerStdioOutput(
      recordingPort(stdoutFrames),
      state,
      'stdout',
      control,
    );
    const stderr = bindDesiredWorkerStdioOutput(
      recordingPort(stderrFrames),
      state,
      'stderr',
      control,
    );

    stdout.write(new TextEncoder().encode('out-0'));
    stderr.write(new TextEncoder().encode('err-1'));
    stdout.write(new TextEncoder().encode('out-2'));

    expect(stdoutFrames).toStrictEqual([
      new TextEncoder().encode('out-0'),
      new TextEncoder().encode('out-2'),
    ]);
    expect(stderrFrames).toStrictEqual([new TextEncoder().encode('err-1')]);
    expect(orderFrames).toStrictEqual([
      {
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 0,
        attestation,
      },
      {
        kind: 'control:stdio-order',
        stream: 'stderr',
        order: 1,
        attestation,
      },
      {
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 2,
        attestation,
      },
    ]);
  });

  it('posts the caller view unchanged without transferring or detaching its buffer', async () => {
    const state = createWorkerOutputState();
    const attestation = workerOutputAttestation(state);
    const output = new MessageChannel();
    const control = new MessageChannel();
    const backing = new Uint8Array([0xaa, 0xbb, 0x6f, 0x75, 0x74, 0xcc, 0xdd]);
    const source = backing.subarray(2, 5);
    const rawFrame = receiveFrame(output.port1);
    const orderFrame = receiveFrame(control.port1);

    try {
      bindDesiredWorkerStdioOutput(output.port2, state, 'stdout', control.port2).write(source);

      expect(source.byteOffset).toBe(2);
      expect(source.byteLength).toBe(3);
      expect([...source]).toEqual([0x6f, 0x75, 0x74]);
      expect(backing.byteLength).toBe(7);
      expect([...backing]).toEqual([0xaa, 0xbb, 0x6f, 0x75, 0x74, 0xcc, 0xdd]);

      const received = await rawFrame;
      expect(received).toBeInstanceOf(Uint8Array);
      expect(received).toMatchObject({ byteOffset: 2, byteLength: 3 });
      expect([...(received as Uint8Array)]).toEqual([0x6f, 0x75, 0x74]);
      expect(await orderFrame).toStrictEqual({
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 0,
        attestation,
      });
    } finally {
      output.port1.close();
      output.port2.close();
      control.port1.close();
      control.port2.close();
    }
  });

  it('captures trusted raw, control, state-view, and Atomics capabilities when bound', () => {
    class MutablePort {
      constructor(readonly frames: unknown[]) {}

      postMessage(frame: unknown): void {
        this.frames.push(frame);
      }
    }

    const state = createWorkerOutputState();
    const nativeRawFrames: unknown[] = [];
    const nativeOrderFrames: unknown[] = [];
    const interceptedRawFrames: unknown[] = [];
    const interceptedOrderFrames: unknown[] = [];
    const outputPort = new MutablePort(nativeRawFrames);
    const controlPort = new MutablePort(nativeOrderFrames);
    const prototypePostDescriptor = Object.getOwnPropertyDescriptor(
      MutablePort.prototype,
      'postMessage',
    );
    if (prototypePostDescriptor === undefined) {
      throw new Error('Expected MutablePort.prototype.postMessage descriptor');
    }
    const trustedBytes = new TextEncoder().encode('trusted');
    const attestation = workerOutputAttestation(state);
    const writer = bindDesiredWorkerStdioOutput(
      outputPort as unknown as MessagePort,
      state,
      'stdout',
      controlPort as unknown as MessagePort,
    );
    Object.defineProperty(outputPort, 'postMessage', {
      configurable: true,
      value: (frame: unknown) => interceptedRawFrames.push(frame),
    });
    Object.defineProperty(controlPort, 'postMessage', {
      configurable: true,
      value: (frame: unknown) => interceptedOrderFrames.push(frame),
    });
    Object.defineProperty(MutablePort.prototype, 'postMessage', {
      ...prototypePostDescriptor,
      value(this: MutablePort, frame: unknown): void {
        if (this === outputPort) interceptedRawFrames.push(frame);
        else if (this === controlPort) interceptedOrderFrames.push(frame);
        else throw new Error('Unexpected MutablePort receiver');
      },
    });
    const int32ArrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Int32Array');
    if (int32ArrayDescriptor === undefined || !('value' in int32ArrayDescriptor)) {
      throw new Error('Expected global Int32Array data descriptor');
    }
    const NativeInt32Array = Int32Array;
    let interceptedStateViews = 0;
    const InterceptedInt32Array = new Proxy(NativeInt32Array, {
      construct(target, argumentsList, newTarget) {
        interceptedStateViews++;
        return Reflect.construct(target, argumentsList, newTarget);
      },
    });
    const loadSpy = vi.spyOn(Atomics, 'load');
    const compareExchangeSpy = vi.spyOn(Atomics, 'compareExchange');
    const storeSpy = vi.spyOn(Atomics, 'store');
    const notifySpy = vi.spyOn(Atomics, 'notify');

    try {
      Object.defineProperty(globalThis, 'Int32Array', {
        ...int32ArrayDescriptor,
        value: InterceptedInt32Array,
      });
      writer.write(trustedBytes);
      expect(sealWorkerOutput(state)).toBe(true);
      const sealedAttestation = workerOutputAttestation(state);
      const stateViewInterceptsDuringWrite = interceptedStateViews;

      expect(interceptedRawFrames).toEqual([]);
      expect(interceptedOrderFrames).toEqual([]);
      expect(stateViewInterceptsDuringWrite).toBe(0);
      expect(loadSpy).not.toHaveBeenCalled();
      expect(compareExchangeSpy).not.toHaveBeenCalled();
      expect(storeSpy).not.toHaveBeenCalled();
      expect(notifySpy).not.toHaveBeenCalled();
      expect(sealedAttestation).toBe(attestation);
      expect(nativeRawFrames).toStrictEqual([trustedBytes]);
      expect(nativeOrderFrames).toStrictEqual([
        {
          kind: 'control:stdio-order',
          stream: 'stdout',
          order: 0,
          attestation,
        },
      ]);
    } finally {
      Object.defineProperty(MutablePort.prototype, 'postMessage', prototypePostDescriptor);
      Object.defineProperty(globalThis, 'Int32Array', int32ArrayDescriptor);
      loadSpy.mockRestore();
      compareExchangeSpy.mockRestore();
      storeSpy.mockRestore();
      notifySpy.mockRestore();
    }
  });

  it('commits neither target nor order when the raw output post throws', async () => {
    const rawFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    let attempts = 0;
    const output = {
      postMessage(frame: unknown) {
        attempts++;
        if (attempts === 1) throw new Error('injected output post failure');
        rawFrames.push(frame);
      },
    } as unknown as MessagePort;
    const state = createWorkerOutputState();
    const stdout = bindDesiredWorkerStdioOutput(
      output,
      state,
      'stdout',
      recordingPort(orderFrames),
    );

    expect(() => stdout.write(new TextEncoder().encode('failed'))).toThrow(
      'injected output post failure',
    );
    stdout.write(new TextEncoder().encode('committed'));

    expect(sealWorkerOutput(state)).toBe(true);
    expect(await cutWorkerOutput(state)).toEqual({ stdout: 1, stderr: 0 });
    expect(rawFrames).toStrictEqual([new TextEncoder().encode('committed')]);
    expect(orderFrames).toStrictEqual([
      {
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 0,
        attestation: workerOutputAttestation(state),
      },
    ]);
  });

  it('poisons output after its raw bytes post but its order witness post fails', async () => {
    const rawFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    let witnessAttempts = 0;
    const control = {
      postMessage(frame: unknown) {
        witnessAttempts++;
        if (witnessAttempts === 1) throw new Error('injected order witness post failure');
        orderFrames.push(frame);
      },
    } as unknown as MessagePort;
    const state = createWorkerOutputState();
    const stdout = bindDesiredWorkerStdioOutput(recordingPort(rawFrames), state, 'stdout', control);

    expect(() => stdout.write(new TextEncoder().encode('orphan'))).toThrow(
      'injected order witness post failure',
    );
    expect(() => stdout.write(new TextEncoder().encode('later'))).toThrow();
    expect(() => sealWorkerOutput(state)).toThrow();
    expect(() => cutWorkerOutput(state)).toThrow();
    expect(rawFrames).toStrictEqual([new TextEncoder().encode('orphan')]);
    expect(orderFrames).toEqual([]);
  });

  it('holds the active slot across byte, witness, and counter commit against a cut', async () => {
    const state = createWorkerOutputState();
    const words = new Int32Array(state);
    const rawFrames: unknown[] = [];
    const orderFrames: unknown[] = [];
    let activeDuringRawPost = 0;
    let activeDuringWitnessPost = 0;
    let committedDuringWitnessPost = 0;
    let cut: ReturnType<typeof cutWorkerOutput> | undefined;
    const storeSpy = vi.spyOn(Atomics, 'store');
    const output = {
      postMessage(frame: unknown) {
        rawFrames.push(frame);
        activeDuringRawPost = Atomics.load(words, 1);
        cut = cutWorkerOutput(state);
      },
    } as unknown as MessagePort;
    const control = {
      postMessage(frame: unknown) {
        orderFrames.push(frame);
        activeDuringWitnessPost = Atomics.load(words, 1);
        committedDuringWitnessPost = Atomics.load(words, 2);
      },
    } as unknown as MessagePort;

    try {
      const stdout = bindDesiredWorkerStdioOutput(output, state, 'stdout', control);

      stdout.write(new TextEncoder().encode('admitted'));

      expect(activeDuringRawPost).toBe(1);
      expect(activeDuringWitnessPost).toBe(1);
      expect(committedDuringWitnessPost).toBe(0);
      expect(Atomics.load(words, 1)).toBe(0);
      if (cut === undefined) throw new Error('Expected raw post to start the parent cut');
      await expect(cut).resolves.toEqual({ stdout: 1, stderr: 0 });
      expect(rawFrames).toStrictEqual([new TextEncoder().encode('admitted')]);
      expect(orderFrames).toStrictEqual([
        {
          kind: 'control:stdio-order',
          stream: 'stdout',
          order: 0,
          attestation: workerOutputAttestation(state),
        },
      ]);
      expect(
        storeSpy.mock.calls
          .filter(([view]) => view.buffer === state)
          .map(([, index, value]) => [index, value]),
      ).toEqual([
        [2, 1],
        [1, 0],
      ]);
    } finally {
      storeSpy.mockRestore();
    }
  });

  it('cuts without a child task, waits one active admission, then returns both targets', async () => {
    const state = createWorkerOutputState();
    const words = new Int32Array(state);
    Atomics.store(words, 1, 1);
    Atomics.store(words, 2, 3);
    Atomics.store(words, 3, 2);

    const cut = cutWorkerOutput(state);
    expect(Atomics.load(words, 0)).toBe(2);
    Atomics.store(words, 1, 0);
    Atomics.notify(words, 1);

    await expect(cut).resolves.toEqual({ stdout: 3, stderr: 2 });
    const writer = bindDesiredWorkerStdioOutput(
      new MessageChannel().port1,
      state,
      'stdout',
      new MessageChannel().port1,
    );
    expect(() => writer.write(new Uint8Array([1]))).toThrow(
      'Worker stdout write after terminal cut',
    );
  });

  it('fails loud on re-entry and before committed counters wrap', () => {
    const activeState = createWorkerOutputState();
    Atomics.store(new Int32Array(activeState), 1, 1);
    const activeWriter = bindDesiredWorkerStdioOutput(
      new MessageChannel().port1,
      activeState,
      'stdout',
      new MessageChannel().port1,
    );
    expect(() => activeWriter.write(new Uint8Array([1]))).toThrow(
      'Worker output writer re-entered',
    );

    const committedState = createWorkerOutputState();
    Atomics.store(new Int32Array(committedState), 2, MAX_CHUNKS);
    const committedWriter = bindDesiredWorkerStdioOutput(
      new MessageChannel().port1,
      committedState,
      'stdout',
      new MessageChannel().port1,
    );
    expect(() => committedWriter.write(new Uint8Array([1]))).toThrow(
      `Worker stdout exceeded ${String(MAX_CHUNKS)} chunks`,
    );
    expect(Atomics.load(new Int32Array(committedState), 1)).toBe(0);
  });

  it('distinguishes a trusted child seal from an abrupt parent abandonment', () => {
    const childState = createWorkerOutputState();
    expect(sealWorkerOutput(childState)).toBe(true);
    expect(sealWorkerOutput(childState)).toBe(true);
    expect(isWorkerOutputChildSealed(childState)).toBe(true);

    const deadState = createWorkerOutputState();
    Atomics.store(new Int32Array(deadState), 1, 1);
    abandonWorkerOutput(deadState);
    expect(isWorkerOutputChildSealed(deadState)).toBe(false);
    expect(sealWorkerOutput(deadState)).toBe(false);
  });

  it('releases an abrupt teardown while reporting corrupt shared control words', () => {
    const state = createWorkerOutputState();
    const words = new Int32Array(state);
    Atomics.store(words, 0, 41);
    Atomics.store(words, 1, 7);

    expect(() => abandonWorkerOutput(state)).toThrow(
      'Worker output state has invalid phase 41 and active value 7',
    );
    expect(Atomics.load(words, 0)).toBe(2);
    expect(Atomics.load(words, 1)).toBe(0);
  });
});
