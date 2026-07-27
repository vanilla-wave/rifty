import type { KernelStdioOutputWriter } from './shared-globals.ts';

export type WorkerStdioOutputName = 'stdout' | 'stderr';

declare const WORKER_OUTPUT_STATE: unique symbol;

/** Opaque kernel-worker bootstrap capability; layout stays package-internal. */
export type WorkerOutputState = SharedArrayBuffer & {
  readonly [WORKER_OUTPUT_STATE]: true;
};

export interface WorkerOutputTargets {
  readonly stdout: number;
  readonly stderr: number;
}

const PHASE_OPEN = 0;
const PHASE_CHILD_SEALED = 1;
const PHASE_PARENT_CUT = 2;
const PHASE_INDEX = 0;
const ACTIVE_INDEX = 1;
const STDOUT_COMMITTED_INDEX = 2;
const STDERR_COMMITTED_INDEX = 3;
// Exit-frame attestation. The worker-global `postMessage` channel is shared
// with guest code, so the seal phase — a state word read when the parent
// DELIVERS a frame — cannot say who posted it. These two words carry a secret
// the trusted finalizer stamps onto its exit frame; guests never receive the
// state, so they cannot reproduce it (ADR-0332 correction).
const ATTESTATION_HI_INDEX = 4;
const ATTESTATION_LO_INDEX = 5;
const WORD_COUNT = 6;
const MAX_CHUNKS = 0x7fffffff;

function stateView(state: WorkerOutputState): Int32Array {
  const expectedBytes = WORD_COUNT * Int32Array.BYTES_PER_ELEMENT;
  if (state.byteLength !== expectedBytes) {
    throw new RangeError(`Worker output state must be exactly ${String(expectedBytes)} bytes`);
  }
  return new Int32Array(state);
}

export function createWorkerOutputState(): WorkerOutputState {
  const state = new SharedArrayBuffer(
    WORD_COUNT * Int32Array.BYTES_PER_ELEMENT,
  ) as WorkerOutputState;
  const words = new Int32Array(state);
  crypto.getRandomValues(new Uint32Array(state, ATTESTATION_HI_INDEX * 4, 2));
  // A zero pair would let an unattested frame match; re-roll the impossible.
  if (words[ATTESTATION_HI_INDEX] === 0 && words[ATTESTATION_LO_INDEX] === 0) {
    words[ATTESTATION_HI_INDEX] = 1;
  }
  return state;
}

/**
 * The secret the trusted finalizer stamps on its exit frame. Derived from the
 * kernel-owned state, so possessing it IS the proof the frame came from the
 * worker runtime rather than from guest code sharing the global channel.
 */
export function workerOutputAttestation(state: WorkerOutputState): string {
  const words = stateView(state);
  const hi = words[ATTESTATION_HI_INDEX] ?? 0;
  const lo = words[ATTESTATION_LO_INDEX] ?? 0;
  if (hi === 0 && lo === 0) throw new Error('Worker output state carries no exit attestation');
  return `${(hi >>> 0).toString(16)}.${(lo >>> 0).toString(16)}`;
}

function outputPhase(words: Int32Array): number {
  const phase = Atomics.load(words, PHASE_INDEX);
  if (phase !== PHASE_OPEN && phase !== PHASE_CHILD_SEALED && phase !== PHASE_PARENT_CUT) {
    throw new Error(`Worker output state has invalid phase ${String(phase)}`);
  }
  return phase;
}

function writeAfterCutError(output: WorkerStdioOutputName): Error {
  return Object.assign(new Error(`Worker ${output} write after terminal cut`), {
    code: 'ERR_STREAM_WRITE_AFTER_END',
  });
}

function committedIndex(output: WorkerStdioOutputName): number {
  return output === 'stdout' ? STDOUT_COMMITTED_INDEX : STDERR_COMMITTED_INDEX;
}

/**
 * Semantic child writer. One process-wide active slot linearizes both output
 * streams against the parent cut; raw ports and the SAB never reach runtimes.
 */
export function bindWorkerStdioOutput(
  port: MessagePort,
  state: WorkerOutputState,
  output: WorkerStdioOutputName,
): KernelStdioOutputWriter {
  const words = stateView(state);
  const outputCommittedIndex = committedIndex(output);
  return {
    write(bytes) {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError(`Worker ${output} accepts only Uint8Array chunks`);
      }
      if (Atomics.compareExchange(words, ACTIVE_INDEX, 0, 1) !== 0) {
        throw new Error('Worker output writer re-entered while another write was active');
      }
      try {
        if (outputPhase(words) !== PHASE_OPEN) throw writeAfterCutError(output);
        const committed = Atomics.load(words, outputCommittedIndex);
        if (committed < 0 || committed === MAX_CHUNKS) {
          throw new RangeError(`Worker ${output} exceeded ${String(MAX_CHUNKS)} chunks`);
        }
        port.postMessage(bytes);
        Atomics.store(words, outputCommittedIndex, committed + 1);
      } finally {
        Atomics.store(words, ACTIVE_INDEX, 0);
        Atomics.notify(words, ACTIVE_INDEX);
      }
    },
  };
}

/**
 * Trusted child finalizer/self-close attestation. `false` means the parent
 * already cut output (for example, a concurrent signal); it never reopens.
 */
export function sealWorkerOutput(state: WorkerOutputState): boolean {
  const words = stateView(state);
  const phase = outputPhase(words);
  if (phase === PHASE_CHILD_SEALED) return true;
  if (phase === PHASE_PARENT_CUT) return false;
  if (Atomics.load(words, ACTIVE_INDEX) !== 0) {
    throw new Error('Worker output finalizer raced an active write');
  }
  return Atomics.compareExchange(words, PHASE_INDEX, PHASE_OPEN, PHASE_CHILD_SEALED) === PHASE_OPEN;
}

/** Only a child-sealed state can authenticate the worker-global exit frame. */
export function isWorkerOutputChildSealed(state: WorkerOutputState): boolean {
  const words = stateView(state);
  const corrupt: string[] = [];
  const phase = Atomics.load(words, PHASE_INDEX);
  if (phase !== PHASE_OPEN && phase !== PHASE_CHILD_SEALED && phase !== PHASE_PARENT_CUT) {
    corrupt.push(`phase ${String(phase)}`);
  }
  const active = Atomics.load(words, ACTIVE_INDEX);
  if (active !== 0 && active !== 1) corrupt.push(`active value ${String(active)}`);
  if (corrupt.length > 0) {
    throw new Error(`Worker output state has invalid ${corrupt.join(' and ')}`);
  }
  return phase === PHASE_CHILD_SEALED;
}

function beginParentCut(words: Int32Array): void {
  const phase = outputPhase(words);
  if (phase === PHASE_OPEN) {
    const observed = Atomics.compareExchange(words, PHASE_INDEX, PHASE_OPEN, PHASE_PARENT_CUT);
    if (
      observed !== PHASE_OPEN &&
      observed !== PHASE_CHILD_SEALED &&
      observed !== PHASE_PARENT_CUT
    ) {
      throw new Error(`Worker output cut observed invalid phase ${String(observed)}`);
    }
  }
}

interface AtomicsWaitAsyncResult {
  readonly async: boolean;
  readonly value: Promise<'ok' | 'timed-out'> | 'not-equal';
}

interface AtomicsWithWaitAsync {
  waitAsync(typedArray: Int32Array, index: number, value: number): AtomicsWaitAsyncResult;
}

async function waitUntilInactive(words: Int32Array): Promise<void> {
  const waitAsync = (Atomics as unknown as Partial<AtomicsWithWaitAsync>).waitAsync;
  if (typeof waitAsync !== 'function') {
    throw new Error('Worker output cut requires Atomics.waitAsync');
  }
  while (true) {
    const active = Atomics.load(words, ACTIVE_INDEX);
    if (active === 0) return;
    if (active !== 1) {
      throw new Error(`Worker output state has invalid active value ${String(active)}`);
    }
    const waiting = waitAsync(words, ACTIVE_INDEX, active);
    if (waiting.async) await waiting.value;
  }
}

function snapshotTargets(words: Int32Array): WorkerOutputTargets {
  const stdout = Atomics.load(words, STDOUT_COMMITTED_INDEX);
  const stderr = Atomics.load(words, STDERR_COMMITTED_INDEX);
  if (stdout < 0 || stderr < 0) {
    throw new Error(
      `Worker output state has invalid committed counts ${String(stdout)}/${String(stderr)}`,
    );
  }
  return { stdout, stderr };
}

/**
 * Parent-owned terminal cut for a live Worker. New writes fail; an already
 * admitted write either commits or rolls back before the finite targets return.
 */
export function cutWorkerOutput(
  state: WorkerOutputState,
): WorkerOutputTargets | Promise<WorkerOutputTargets> {
  const words = stateView(state);
  beginParentCut(words);
  if (Atomics.load(words, ACTIVE_INDEX) === 0) return snapshotTargets(words);
  return waitUntilInactive(words).then(() => snapshotTargets(words));
}

/**
 * Physical-death cut: blocks any surviving writer but deliberately does not
 * wait or return targets. Abrupt death cannot attest complete drain.
 */
export function abandonWorkerOutput(state: WorkerOutputState): void {
  const words = stateView(state);
  const corrupt: string[] = [];
  const phase = Atomics.load(words, PHASE_INDEX);
  if (phase === PHASE_OPEN) {
    const observed = Atomics.compareExchange(words, PHASE_INDEX, PHASE_OPEN, PHASE_PARENT_CUT);
    if (
      observed !== PHASE_OPEN &&
      observed !== PHASE_CHILD_SEALED &&
      observed !== PHASE_PARENT_CUT
    ) {
      corrupt.push(`phase ${String(observed)}`);
      Atomics.store(words, PHASE_INDEX, PHASE_PARENT_CUT);
    }
  } else if (phase !== PHASE_CHILD_SEALED && phase !== PHASE_PARENT_CUT) {
    corrupt.push(`phase ${String(phase)}`);
    Atomics.store(words, PHASE_INDEX, PHASE_PARENT_CUT);
  }
  const active = Atomics.exchange(words, ACTIVE_INDEX, 0);
  if (active !== 0 && active !== 1) corrupt.push(`active value ${String(active)}`);
  Atomics.notify(words, ACTIVE_INDEX);
  if (corrupt.length > 0) {
    throw new Error(`Worker output state has invalid ${corrupt.join(' and ')}`);
  }
}
