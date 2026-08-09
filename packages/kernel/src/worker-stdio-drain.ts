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

export interface WorkerStdioOrderFrame {
  readonly kind: 'control:stdio-order';
  readonly stream: WorkerStdioOutputName;
  readonly order: number;
  readonly attestation: string;
}

export interface WorkerStdioOutputReceiverEvents {
  onChunk(stream: WorkerStdioOutputName, bytes: Uint8Array): void;
  onDrained(): void;
  onProtocolError(error: Error): void;
}

export interface WorkerStdioOutputReceiver {
  acceptOrderFrame(frame: unknown): void;
  cut(targets: unknown): void;
  abandon(): void;
}

const PHASE_OPEN = 0;
const PHASE_CHILD_SEALED = 1;
const PHASE_PARENT_CUT = 2;
const PHASE_BROKEN = 3;
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
const TOTAL_CHUNK_CEILING = MAX_CHUNKS * 2;

interface AtomicsWaitAsyncResult {
  readonly async: boolean;
  readonly value: Promise<'ok' | 'timed-out'> | 'not-equal';
}

interface AtomicsWithWaitAsync {
  waitAsync(typedArray: Int32Array, index: number, value: number): AtomicsWaitAsyncResult;
}

interface WorkerOutputStateAccess {
  readonly words: Int32Array;
  load(index: number): number;
  store(index: number, value: number): number;
  compareExchange(index: number, expected: number, replacement: number): number;
  exchange(index: number, value: number): number;
  notify(index: number): number;
  waitAsync(index: number, value: number): AtomicsWaitAsyncResult | null;
}

const boundStateAccess = new WeakMap<WorkerOutputState, WorkerOutputStateAccess>();

function captureStateAccess(state: WorkerOutputState): WorkerOutputStateAccess {
  const NativeInt32Array = Int32Array;
  const expectedBytes = WORD_COUNT * NativeInt32Array.BYTES_PER_ELEMENT;
  if (state.byteLength !== expectedBytes) {
    throw new RangeError(`Worker output state must be exactly ${String(expectedBytes)} bytes`);
  }
  const words = new NativeInt32Array(state);
  const atomics = Atomics;
  const load = atomics.load.bind(atomics);
  const store = atomics.store.bind(atomics);
  const compareExchange = atomics.compareExchange.bind(atomics);
  const exchange = atomics.exchange.bind(atomics);
  const notify = atomics.notify.bind(atomics);
  const waitAsyncMethod = (atomics as unknown as Partial<AtomicsWithWaitAsync>).waitAsync;
  const waitAsync =
    typeof waitAsyncMethod === 'function'
      ? waitAsyncMethod.bind(atomics as unknown as AtomicsWithWaitAsync)
      : null;
  return {
    words,
    load: (index) => load(words, index),
    store: (index, value) => store(words, index, value),
    compareExchange: (index, expected, replacement) =>
      compareExchange(words, index, expected, replacement),
    exchange: (index, value) => exchange(words, index, value),
    notify: (index) => notify(words, index),
    waitAsync: (index, value) => waitAsync?.(words, index, value) ?? null,
  };
}

function stateAccess(state: WorkerOutputState): WorkerOutputStateAccess {
  return boundStateAccess.get(state) ?? captureStateAccess(state);
}

function bindStateAccess(state: WorkerOutputState): WorkerOutputStateAccess {
  const existing = boundStateAccess.get(state);
  if (existing !== undefined) return existing;
  const access = captureStateAccess(state);
  boundStateAccess.set(state, access);
  return access;
}

export function createWorkerOutputState(): WorkerOutputState {
  const state = new SharedArrayBuffer(
    WORD_COUNT * Int32Array.BYTES_PER_ELEMENT,
  ) as WorkerOutputState;
  const words = new Int32Array(state);
  // Browsers refuse `getRandomValues` on a view backed by shared memory, so
  // draw into private memory and copy the words across.
  const secret = new Uint32Array(2);
  crypto.getRandomValues(secret);
  // A zero pair would let an unattested frame match; re-roll the impossible.
  if (secret[0] === 0 && secret[1] === 0) secret[0] = 1;
  words[ATTESTATION_HI_INDEX] = secret[0] as number;
  words[ATTESTATION_LO_INDEX] = secret[1] as number;
  return state;
}

/**
 * The secret the trusted finalizer stamps on its exit frame. Derived from the
 * kernel-owned state, so possessing it IS the proof the frame came from the
 * worker runtime rather than from guest code sharing the global channel.
 */
export function workerOutputAttestation(state: WorkerOutputState): string {
  return outputAttestation(stateAccess(state));
}

function outputAttestation(access: WorkerOutputStateAccess): string {
  const { words } = access;
  const hi = words[ATTESTATION_HI_INDEX] ?? 0;
  const lo = words[ATTESTATION_LO_INDEX] ?? 0;
  if (hi === 0 && lo === 0) throw new Error('Worker output state carries no exit attestation');
  return `${(hi >>> 0).toString(16)}.${(lo >>> 0).toString(16)}`;
}

function brokenOutputError(): Error {
  return new Error('Worker output state is broken after an order witness post failure');
}

function outputPhase(access: WorkerOutputStateAccess): number {
  const phase = access.load(PHASE_INDEX);
  if (phase === PHASE_BROKEN) throw brokenOutputError();
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
  controlPort: MessagePort,
): KernelStdioOutputWriter {
  const access = bindStateAccess(state);
  const outputCommittedIndex = committedIndex(output);
  const otherCommittedIndex = output === 'stdout' ? STDERR_COMMITTED_INDEX : STDOUT_COMMITTED_INDEX;
  const postOutput = port.postMessage.bind(port) as (message: unknown) => void;
  const postControl = controlPort.postMessage.bind(controlPort) as (message: unknown) => void;
  const attestation = outputAttestation(access);
  return {
    write(bytes) {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError(`Worker ${output} accepts only Uint8Array chunks`);
      }
      if (access.compareExchange(ACTIVE_INDEX, 0, 1) !== 0) {
        throw new Error('Worker output writer re-entered while another write was active');
      }
      try {
        if (outputPhase(access) !== PHASE_OPEN) throw writeAfterCutError(output);
        const committed = access.load(outputCommittedIndex);
        if (committed < 0 || committed === MAX_CHUNKS) {
          throw new RangeError(`Worker ${output} exceeded ${String(MAX_CHUNKS)} chunks`);
        }
        const otherCommitted = access.load(otherCommittedIndex);
        if (otherCommitted < 0 || otherCommitted > MAX_CHUNKS) {
          throw new Error(
            `Worker output state has invalid committed counts ${String(
              output === 'stdout' ? committed : otherCommitted,
            )}/${String(output === 'stdout' ? otherCommitted : committed)}`,
          );
        }
        const order = committed + otherCommitted;
        if (!Number.isSafeInteger(order) || order < 0 || order >= TOTAL_CHUNK_CEILING) {
          throw new RangeError(`Worker output order ${String(order)} is outside its safe range`);
        }
        const witness: WorkerStdioOrderFrame = {
          kind: 'control:stdio-order',
          stream: output,
          order,
          attestation,
        };
        postOutput(bytes);
        try {
          postControl(witness);
        } catch (error) {
          access.store(PHASE_INDEX, PHASE_BROKEN);
          throw error;
        }
        access.store(outputCommittedIndex, committed + 1);
      } finally {
        access.store(ACTIVE_INDEX, 0);
        access.notify(ACTIVE_INDEX);
      }
    },
  };
}

/**
 * Trusted child finalizer/self-close attestation. `false` means the parent
 * already cut output (for example, a concurrent signal); it never reopens.
 */
export function sealWorkerOutput(state: WorkerOutputState): boolean {
  const access = stateAccess(state);
  const phase = outputPhase(access);
  if (phase === PHASE_CHILD_SEALED) return true;
  if (phase === PHASE_PARENT_CUT) return false;
  if (access.load(ACTIVE_INDEX) !== 0) {
    throw new Error('Worker output finalizer raced an active write');
  }
  const observed = access.compareExchange(PHASE_INDEX, PHASE_OPEN, PHASE_CHILD_SEALED);
  if (observed === PHASE_OPEN || observed === PHASE_CHILD_SEALED) return true;
  if (observed === PHASE_PARENT_CUT) return false;
  if (observed === PHASE_BROKEN) throw brokenOutputError();
  throw new Error(`Worker output state has invalid phase ${String(observed)}`);
}

/** Only a child-sealed state can authenticate the worker-global exit frame. */
export function isWorkerOutputChildSealed(state: WorkerOutputState): boolean {
  const access = stateAccess(state);
  const corrupt: string[] = [];
  const phase = access.load(PHASE_INDEX);
  if (phase === PHASE_BROKEN) throw brokenOutputError();
  if (phase !== PHASE_OPEN && phase !== PHASE_CHILD_SEALED && phase !== PHASE_PARENT_CUT) {
    corrupt.push(`phase ${String(phase)}`);
  }
  const active = access.load(ACTIVE_INDEX);
  if (active !== 0 && active !== 1) corrupt.push(`active value ${String(active)}`);
  if (corrupt.length > 0) {
    throw new Error(`Worker output state has invalid ${corrupt.join(' and ')}`);
  }
  return phase === PHASE_CHILD_SEALED;
}

function beginParentCut(access: WorkerOutputStateAccess): void {
  const phase = outputPhase(access);
  if (phase === PHASE_OPEN) {
    const observed = access.compareExchange(PHASE_INDEX, PHASE_OPEN, PHASE_PARENT_CUT);
    if (observed === PHASE_BROKEN) throw brokenOutputError();
    if (
      observed !== PHASE_OPEN &&
      observed !== PHASE_CHILD_SEALED &&
      observed !== PHASE_PARENT_CUT
    ) {
      throw new Error(`Worker output cut observed invalid phase ${String(observed)}`);
    }
  }
}

async function waitUntilInactive(access: WorkerOutputStateAccess): Promise<void> {
  while (true) {
    const active = access.load(ACTIVE_INDEX);
    if (active === 0) return;
    if (active !== 1) {
      throw new Error(`Worker output state has invalid active value ${String(active)}`);
    }
    const waiting = access.waitAsync(ACTIVE_INDEX, active);
    if (waiting === null) throw new Error('Worker output cut requires Atomics.waitAsync');
    if (waiting.async) await waiting.value;
  }
}

function snapshotTargets(access: WorkerOutputStateAccess): WorkerOutputTargets {
  outputPhase(access);
  const stdout = access.load(STDOUT_COMMITTED_INDEX);
  const stderr = access.load(STDERR_COMMITTED_INDEX);
  if (stdout < 0 || stdout > MAX_CHUNKS || stderr < 0 || stderr > MAX_CHUNKS) {
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
  const access = stateAccess(state);
  beginParentCut(access);
  if (access.load(ACTIVE_INDEX) === 0) return snapshotTargets(access);
  return waitUntilInactive(access).then(() => snapshotTargets(access));
}

/**
 * Physical-death cut: blocks any surviving writer but deliberately does not
 * wait or return targets. Abrupt death cannot attest complete drain.
 */
export function abandonWorkerOutput(state: WorkerOutputState): void {
  const access = stateAccess(state);
  const corrupt: string[] = [];
  const phase = access.load(PHASE_INDEX);
  if (phase === PHASE_OPEN) {
    const observed = access.compareExchange(PHASE_INDEX, PHASE_OPEN, PHASE_PARENT_CUT);
    if (
      observed !== PHASE_OPEN &&
      observed !== PHASE_CHILD_SEALED &&
      observed !== PHASE_PARENT_CUT &&
      observed !== PHASE_BROKEN
    ) {
      corrupt.push(`phase ${String(observed)}`);
      access.store(PHASE_INDEX, PHASE_PARENT_CUT);
    }
  } else if (phase !== PHASE_CHILD_SEALED && phase !== PHASE_PARENT_CUT && phase !== PHASE_BROKEN) {
    corrupt.push(`phase ${String(phase)}`);
    access.store(PHASE_INDEX, PHASE_PARENT_CUT);
  }
  const active = access.exchange(ACTIVE_INDEX, 0);
  if (active !== 0 && active !== 1) corrupt.push(`active value ${String(active)}`);
  access.notify(ACTIVE_INDEX);
  if (corrupt.length > 0) {
    throw new Error(`Worker output state has invalid ${corrupt.join(' and ')}`);
  }
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  owner: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field))
  ) {
    throw new TypeError(`${owner} must contain exactly ${fields.join(', ')}`);
  }
  return record;
}

export function decodeWorkerStdioOrderFrame(value: unknown): WorkerStdioOrderFrame {
  const record = exactRecord(
    value,
    ['kind', 'stream', 'order', 'attestation'],
    'Worker stdio order witness',
  );
  if (record.kind !== 'control:stdio-order') {
    throw new TypeError('Worker stdio order witness has an invalid kind');
  }
  if (record.stream !== 'stdout' && record.stream !== 'stderr') {
    throw new TypeError('Worker stdio order witness has an invalid stream');
  }
  if (
    typeof record.order !== 'number' ||
    !Number.isSafeInteger(record.order) ||
    record.order < 0 ||
    record.order >= TOTAL_CHUNK_CEILING
  ) {
    throw new RangeError('Worker stdio order witness has an invalid order');
  }
  if (typeof record.attestation !== 'string') {
    throw new TypeError('Worker stdio order witness has an invalid attestation');
  }
  return {
    kind: record.kind,
    stream: record.stream,
    order: record.order,
    attestation: record.attestation,
  };
}

function decodeWorkerOutputTargets(value: unknown): WorkerOutputTargets {
  const record = exactRecord(value, ['stdout', 'stderr'], 'Worker stdio terminal target');
  const target = (stream: WorkerStdioOutputName): number => {
    const chunks = record[stream];
    if (
      typeof chunks !== 'number' ||
      !Number.isSafeInteger(chunks) ||
      chunks < 0 ||
      chunks > MAX_CHUNKS
    ) {
      throw new RangeError(`Worker ${stream} terminal target is invalid`);
    }
    return chunks;
  };
  return { stdout: target('stdout'), stderr: target('stderr') };
}

type ReceiverPhase = 'open' | 'cut' | 'drained' | 'failed' | 'abandoned';

/**
 * One parent-side authority pairs public raw bytes with authenticated order
 * witnesses before exposing the longest contiguous child-write prefix.
 */
export function bindWorkerStdioOutputReceiver(
  ports: Readonly<{ stdout: MessagePort; stderr: MessagePort }>,
  state: WorkerOutputState,
  events: WorkerStdioOutputReceiverEvents,
): WorkerStdioOutputReceiver {
  const attestation = workerOutputAttestation(state);
  const raw = {
    stdout: [] as Array<Uint8Array | undefined>,
    stderr: [] as Array<Uint8Array | undefined>,
  };
  const witnesses: Array<WorkerStdioOutputName | undefined> = [];
  const rawSeen: Record<WorkerStdioOutputName, number> = { stdout: 0, stderr: 0 };
  const witnessSeen: Record<WorkerStdioOutputName, number> = { stdout: 0, stderr: 0 };
  const paired: Record<WorkerStdioOutputName, number> = { stdout: 0, stderr: 0 };
  let phase: ReceiverPhase = 'open';
  let targets: WorkerOutputTargets | null = null;
  let witnessTotal = 0;
  let nextOrder = 0;
  let projecting = false;

  const isStopped = (): boolean => phase === 'failed' || phase === 'abandoned';

  const clearBuffered = (): void => {
    raw.stdout.length = 0;
    raw.stderr.length = 0;
    witnesses.length = 0;
  };

  const fail = (error: Error): void => {
    if (phase === 'failed' || phase === 'abandoned') return;
    phase = 'failed';
    clearBuffered();
    events.onProtocolError(error);
  };

  const maybeDrain = (): void => {
    if (phase !== 'cut' || targets === null) return;
    const total = targets.stdout + targets.stderr;
    if (
      rawSeen.stdout !== targets.stdout ||
      rawSeen.stderr !== targets.stderr ||
      witnessSeen.stdout !== targets.stdout ||
      witnessSeen.stderr !== targets.stderr ||
      paired.stdout !== targets.stdout ||
      paired.stderr !== targets.stderr ||
      witnessTotal !== total ||
      nextOrder !== total
    ) {
      return;
    }
    phase = 'drained';
    clearBuffered();
    events.onDrained();
  };

  const project = (): void => {
    if (projecting || isStopped()) return;
    projecting = true;
    try {
      while (!isStopped()) {
        const stream = witnesses[nextOrder];
        if (stream === undefined) break;
        const streamOrder = paired[stream];
        const bytes = raw[stream][streamOrder];
        if (bytes === undefined) break;
        witnesses[nextOrder] = undefined;
        raw[stream][streamOrder] = undefined;
        paired[stream] = streamOrder + 1;
        nextOrder++;
        events.onChunk(stream, bytes);
      }
    } finally {
      projecting = false;
    }
    maybeDrain();
  };

  const rejectOverrun = (
    counts: Record<WorkerStdioOutputName, number>,
    stream: WorkerStdioOutputName,
    evidence: 'raw' | 'witness',
  ): boolean => {
    const target = targets?.[stream];
    if (counts[stream] === MAX_CHUNKS || (target !== undefined && counts[stream] >= target)) {
      fail(new Error(`Worker ${stream} ${evidence} output exceeded its terminal target`));
      return true;
    }
    return false;
  };

  const acceptRaw = (stream: WorkerStdioOutputName, frame: unknown): void => {
    if (phase === 'failed' || phase === 'abandoned') return;
    if (!(frame instanceof Uint8Array)) {
      fail(new Error('Worker stdio received a malformed frame'));
      return;
    }
    if (rejectOverrun(rawSeen, stream, 'raw')) return;
    raw[stream].push(frame);
    rawSeen[stream]++;
    project();
  };

  for (const stream of ['stdout', 'stderr'] as const) {
    const port = ports[stream];
    port.addEventListener('message', (event) => acceptRaw(stream, event.data));
    port.addEventListener('messageerror', () => {
      fail(new Error('Worker stdio failed to deserialize a frame'));
    });
    port.start();
  }

  return {
    acceptOrderFrame(frame) {
      if (phase === 'failed' || phase === 'abandoned') return;
      let witness: WorkerStdioOrderFrame;
      try {
        witness = decodeWorkerStdioOrderFrame(frame);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (witness.attestation !== attestation) {
        fail(new Error('Worker stdio order witness has invalid provenance'));
        return;
      }
      if (witness.order !== witnessTotal) {
        fail(
          new Error(
            `Worker stdio order witness expected ${String(witnessTotal)} but received ${String(
              witness.order,
            )}`,
          ),
        );
        return;
      }
      if (rejectOverrun(witnessSeen, witness.stream, 'witness')) return;
      witnesses.push(witness.stream);
      witnessSeen[witness.stream]++;
      witnessTotal++;
      project();
    },
    cut(value) {
      if (phase === 'failed' || phase === 'abandoned') return;
      let next: WorkerOutputTargets;
      try {
        next = decodeWorkerOutputTargets(value);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (targets !== null) {
        if (targets.stdout !== next.stdout || targets.stderr !== next.stderr) {
          fail(new Error('Worker stdio terminal target changed after the cut'));
        }
        return;
      }
      targets = next;
      if (
        rawSeen.stdout > next.stdout ||
        rawSeen.stderr > next.stderr ||
        witnessSeen.stdout > next.stdout ||
        witnessSeen.stderr > next.stderr ||
        paired.stdout > next.stdout ||
        paired.stderr > next.stderr ||
        witnessTotal > next.stdout + next.stderr ||
        nextOrder > next.stdout + next.stderr
      ) {
        fail(new Error('Worker stdio evidence exceeded its terminal target'));
        return;
      }
      phase = 'cut';
      project();
      maybeDrain();
    },
    abandon() {
      if (phase === 'abandoned') return;
      phase = 'abandoned';
      clearBuffered();
    },
  };
}
