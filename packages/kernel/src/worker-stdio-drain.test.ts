import { describe, expect, it } from 'vitest';
import {
  abandonWorkerOutput,
  bindWorkerStdioOutput,
  createWorkerOutputState,
  cutWorkerOutput,
  isWorkerOutputChildSealed,
  sealWorkerOutput,
} from './worker-stdio-drain.ts';

const MAX_CHUNKS = 0x7fffffff;

describe('Worker process-wide output cut', () => {
  it('counts byte writes per stream behind one child-sealed terminal phase', async () => {
    const stdout = new MessageChannel();
    const stderr = new MessageChannel();
    const state = createWorkerOutputState();
    const stdoutChunk = new Promise<Uint8Array>((resolve) => {
      stdout.port1.onmessage = (event) => resolve(event.data as Uint8Array);
      stdout.port1.start();
    });

    bindWorkerStdioOutput(stdout.port2, state, 'stdout').write(new TextEncoder().encode('last'));
    bindWorkerStdioOutput(stderr.port2, state, 'stderr').write(new Uint8Array([0x21]));

    expect(sealWorkerOutput(state)).toBe(true);
    expect(isWorkerOutputChildSealed(state)).toBe(true);
    expect(await cutWorkerOutput(state)).toEqual({ stdout: 1, stderr: 1 });
    expect(new TextDecoder().decode(await stdoutChunk)).toBe('last');
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
    const writer = bindWorkerStdioOutput(new MessageChannel().port1, state, 'stdout');
    expect(() => writer.write(new Uint8Array([1]))).toThrow(
      'Worker stdout write after terminal cut',
    );
  });

  it('fails loud on re-entry and before committed counters wrap', () => {
    const activeState = createWorkerOutputState();
    Atomics.store(new Int32Array(activeState), 1, 1);
    const activeWriter = bindWorkerStdioOutput(new MessageChannel().port1, activeState, 'stdout');
    expect(() => activeWriter.write(new Uint8Array([1]))).toThrow(
      'Worker output writer re-entered',
    );

    const committedState = createWorkerOutputState();
    Atomics.store(new Int32Array(committedState), 2, MAX_CHUNKS);
    const committedWriter = bindWorkerStdioOutput(
      new MessageChannel().port1,
      committedState,
      'stdout',
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
