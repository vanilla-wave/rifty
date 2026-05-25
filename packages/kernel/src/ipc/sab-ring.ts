/**
 * SAB request/reply ring (ADR-0011, phase 1).
 *
 * A `SharedArrayBuffer`-backed, single-request-at-a-time channel between a
 * caller (typically a child Worker that needs a synchronous Node-style call)
 * and a responder (typically the kernel/parent that services the syscall).
 *
 * # Byte layout
 *
 * ```
 *   ┌────────────┬───────────┬───────────────────────────────────────────┐
 *   │  0 ..   4  │ REQ_STATE │ Int32; 0 = idle, 1 = request-pending      │
 *   │  4 ..   8  │ REP_STATE │ Int32; 0 = no-reply, 1 = reply-ready      │
 *   │  8 ..  12  │ REQ_LEN   │ Int32; request payload length in bytes    │
 *   │ 12 ..  16  │ REP_LEN   │ Int32; reply payload length in bytes      │
 *   │ 16 .. 16+C │ REQ_PAY   │ request payload (C = payloadCapacity)     │
 *   │16+C..16+2C │ REP_PAY   │ reply payload                             │
 *   └────────────┴───────────┴───────────────────────────────────────────┘
 * ```
 *
 * The Int32 slots at offsets 0/4 are the wait-notify targets for
 * `Atomics.wait` / `Atomics.notify`.
 *
 * # Protocol
 *
 * Single-request-at-a-time. The caller writes a request and blocks via
 * `waitReply`; the responder reads via `readRequest` and answers via
 * `writeReply`. Multi-in-flight pipelining is out of scope until usage
 * proves the need (per ADR-0011).
 */

// `Atomics.waitAsync` ships in ES2024; lib target is ES2023, so we declare
// the narrow signature here rather than bump the workspace-wide lib option.
type WaitAsyncResult =
  | { async: false; value: 'ok' | 'not-equal' | 'timed-out' }
  | { async: true; value: Promise<'ok' | 'timed-out'> };
interface AtomicsWithWaitAsync {
  waitAsync(
    typedArray: Int32Array,
    index: number,
    value: number,
    timeout?: number,
  ): WaitAsyncResult;
}
function atomicsWaitAsync(
  typedArray: Int32Array,
  index: number,
  value: number,
  timeout: number,
): WaitAsyncResult {
  return (Atomics as unknown as AtomicsWithWaitAsync).waitAsync(typedArray, index, value, timeout);
}

export const SAB_RING_HEADER_BYTES = 16;
export const REQ_STATE_OFFSET = 0;
export const REP_STATE_OFFSET = 4;
export const REQ_LEN_OFFSET = 8;
export const REP_LEN_OFFSET = 12;
export const DEFAULT_PAYLOAD_CAPACITY = 1024 * 1024; // 1 MiB

const STATE_IDLE = 0;
const STATE_READY = 1;
const REQ_STATE_INDEX = REQ_STATE_OFFSET >> 2;
const REP_STATE_INDEX = REP_STATE_OFFSET >> 2;
const REQ_LEN_INDEX = REQ_LEN_OFFSET >> 2;
const REP_LEN_INDEX = REP_LEN_OFFSET >> 2;

/** Compile-time documentation of the header layout; useful for consumers. */
export interface SabRingHeader {
  readonly REQ_STATE: typeof REQ_STATE_OFFSET;
  readonly REP_STATE: typeof REP_STATE_OFFSET;
  readonly REQ_LEN: typeof REQ_LEN_OFFSET;
  readonly REP_LEN: typeof REP_LEN_OFFSET;
  readonly HEADER_BYTES: typeof SAB_RING_HEADER_BYTES;
  readonly REQ_PAYLOAD_OFFSET: number;
  readonly REP_PAYLOAD_OFFSET: number;
  readonly PAYLOAD_CAPACITY: number;
}

/** Thrown by {@link SabRing.waitReply} when the timeout elapses. */
export class RingTimeoutError extends Error {
  readonly code = 'ERINGTIMEOUT' as const;
  constructor(timeoutMs: number) {
    super(`SAB ring waitReply timed out after ${timeoutMs}ms`);
    this.name = 'RingTimeoutError';
  }
}

/** Thrown when a payload exceeds the ring's configured capacity. */
export class RingPayloadTooLargeError extends Error {
  readonly code = 'ERINGPAYLOAD' as const;
  constructor(
    readonly bytes: number,
    readonly capacity: number,
  ) {
    super(`SAB ring payload (${bytes} bytes) exceeds capacity (${capacity} bytes)`);
    this.name = 'RingPayloadTooLargeError';
  }
}

export interface CreateSabRingOptions {
  /** Per-direction payload capacity in bytes. Defaults to 1 MiB. */
  payloadCapacity?: number;
}

export interface CreateSabRingResult {
  readonly sab: SharedArrayBuffer;
  readonly ring: SabRing;
}

/**
 * Allocates a new {@link SharedArrayBuffer} sized for a single ring and
 * returns both the buffer (to transfer to another realm) and a {@link SabRing}
 * wrapper for the local side. The peer realm constructs its own wrapper from
 * the same `sab` via {@link SabRing.attach}.
 */
export function createSabRing(opts: CreateSabRingOptions = {}): CreateSabRingResult {
  const payloadCapacity = opts.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY;
  if (!Number.isInteger(payloadCapacity) || payloadCapacity <= 0) {
    throw new RangeError(
      `createSabRing: payloadCapacity must be a positive integer, got ${payloadCapacity}`,
    );
  }
  const totalBytes = SAB_RING_HEADER_BYTES + payloadCapacity * 2;
  const sab = new SharedArrayBuffer(totalBytes);
  return { sab, ring: SabRing.attach(sab, payloadCapacity) };
}

/**
 * Wrapper around a {@link SharedArrayBuffer} that implements the
 * request/reply protocol described at the top of this file.
 *
 * The same class is used on both the caller and responder sides — the role
 * is determined by which methods you invoke. {@link writeRequest} and
 * {@link waitReply} are caller-side; {@link readRequest} and
 * {@link writeReply} are responder-side.
 */
export class SabRing {
  private readonly i32: Int32Array;
  private readonly bytes: Uint8Array;
  readonly payloadCapacity: number;
  readonly reqPayloadOffset: number;
  readonly repPayloadOffset: number;
  readonly header: SabRingHeader;

  private constructor(sab: SharedArrayBuffer, payloadCapacity: number) {
    const expected = SAB_RING_HEADER_BYTES + payloadCapacity * 2;
    if (sab.byteLength < expected) {
      throw new RangeError(
        `SabRing: SharedArrayBuffer is ${sab.byteLength} bytes; expected at least ${expected}`,
      );
    }
    this.i32 = new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2);
    this.bytes = new Uint8Array(sab);
    this.payloadCapacity = payloadCapacity;
    this.reqPayloadOffset = SAB_RING_HEADER_BYTES;
    this.repPayloadOffset = SAB_RING_HEADER_BYTES + payloadCapacity;
    this.header = {
      REQ_STATE: REQ_STATE_OFFSET,
      REP_STATE: REP_STATE_OFFSET,
      REQ_LEN: REQ_LEN_OFFSET,
      REP_LEN: REP_LEN_OFFSET,
      HEADER_BYTES: SAB_RING_HEADER_BYTES,
      REQ_PAYLOAD_OFFSET: this.reqPayloadOffset,
      REP_PAYLOAD_OFFSET: this.repPayloadOffset,
      PAYLOAD_CAPACITY: payloadCapacity,
    };
  }

  /**
   * Attaches a {@link SabRing} to an existing {@link SharedArrayBuffer}.
   * Both peers must agree on `payloadCapacity`; the spawner picks the
   * capacity, allocates the SAB, and ships both values to the child as
   * part of its bootstrap message.
   */
  static attach(sab: SharedArrayBuffer, payloadCapacity = DEFAULT_PAYLOAD_CAPACITY): SabRing {
    return new SabRing(sab, payloadCapacity);
  }

  /**
   * Caller-side: copy `payload` into the request slot and wake any responder
   * blocked on REQ_STATE. Throws {@link RingPayloadTooLargeError} when the
   * payload exceeds capacity. Throws if a previous reply/request is still
   * unread — the single-in-flight invariant guards against lost replies.
   */
  writeRequest(payload: Uint8Array): void {
    if (payload.byteLength > this.payloadCapacity) {
      throw new RingPayloadTooLargeError(payload.byteLength, this.payloadCapacity);
    }
    if (Atomics.load(this.i32, REP_STATE_INDEX) !== STATE_IDLE) {
      throw new Error('SabRing: cannot writeRequest while a previous reply is unread');
    }
    if (Atomics.load(this.i32, REQ_STATE_INDEX) !== STATE_IDLE) {
      throw new Error('SabRing: cannot writeRequest while a previous request is unread');
    }
    this.bytes.set(payload, this.reqPayloadOffset);
    Atomics.store(this.i32, REQ_LEN_INDEX, payload.byteLength);
    Atomics.store(this.i32, REQ_STATE_INDEX, STATE_READY);
    Atomics.notify(this.i32, REQ_STATE_INDEX);
  }

  /**
   * Caller-side: synchronously block until the responder posts a reply,
   * then return the reply bytes. Uses {@link Atomics.wait} — MUST be called
   * from a Worker realm. Throws {@link RingTimeoutError} on timeout. After
   * a successful return both state slots are idle, so the caller may
   * immediately {@link writeRequest} again.
   */
  waitReply(timeoutMs?: number): Uint8Array {
    const timeout = timeoutMs ?? Number.POSITIVE_INFINITY;
    const result = Atomics.wait(this.i32, REP_STATE_INDEX, STATE_IDLE, timeout);
    if (result === 'timed-out') throw new RingTimeoutError(timeout);
    return this.consumeReply();
  }

  /**
   * Async sibling of {@link waitReply}. Uses {@link Atomics.waitAsync} so it
   * can be awaited from any realm (the parent-side test driver, or tests
   * where the "caller" runs in the same realm as the responder). Not part
   * of the production caller API.
   */
  async waitReplyAsync(timeoutMs?: number): Promise<Uint8Array> {
    const timeout = timeoutMs ?? Number.POSITIVE_INFINITY;
    const pending = atomicsWaitAsync(this.i32, REP_STATE_INDEX, STATE_IDLE, timeout);
    const result = pending.async ? await pending.value : pending.value;
    if (result === 'timed-out') throw new RingTimeoutError(timeout);
    return this.consumeReply();
  }

  private consumeReply(): Uint8Array {
    const len = Atomics.load(this.i32, REP_LEN_INDEX);
    if (len < 0 || len > this.payloadCapacity) {
      throw new Error(`SabRing: corrupt reply length ${len} (capacity ${this.payloadCapacity})`);
    }
    const out = new Uint8Array(len);
    out.set(this.bytes.subarray(this.repPayloadOffset, this.repPayloadOffset + len));
    Atomics.store(this.i32, REP_LEN_INDEX, 0);
    Atomics.store(this.i32, REP_STATE_INDEX, STATE_IDLE);
    return out;
  }

  /**
   * Responder-side: non-blocking. Returns the request payload bytes (a
   * fresh `Uint8Array` copy) when a request is pending, or `null` otherwise.
   * Clears REQ_STATE on success.
   */
  readRequest(): Uint8Array | null {
    if (Atomics.load(this.i32, REQ_STATE_INDEX) !== STATE_READY) return null;
    const len = Atomics.load(this.i32, REQ_LEN_INDEX);
    if (len < 0 || len > this.payloadCapacity) {
      throw new Error(`SabRing: corrupt request length ${len} (capacity ${this.payloadCapacity})`);
    }
    const out = new Uint8Array(len);
    out.set(this.bytes.subarray(this.reqPayloadOffset, this.reqPayloadOffset + len));
    Atomics.store(this.i32, REQ_LEN_INDEX, 0);
    Atomics.store(this.i32, REQ_STATE_INDEX, STATE_IDLE);
    return out;
  }

  /**
   * Responder-side: write the reply bytes and notify the caller. The
   * caller's {@link waitReply} returns once this completes.
   */
  writeReply(payload: Uint8Array): void {
    if (payload.byteLength > this.payloadCapacity) {
      throw new RingPayloadTooLargeError(payload.byteLength, this.payloadCapacity);
    }
    if (Atomics.load(this.i32, REP_STATE_INDEX) !== STATE_IDLE) {
      throw new Error('SabRing: cannot writeReply while a previous reply is unread');
    }
    this.bytes.set(payload, this.repPayloadOffset);
    Atomics.store(this.i32, REP_LEN_INDEX, payload.byteLength);
    Atomics.store(this.i32, REP_STATE_INDEX, STATE_READY);
    Atomics.notify(this.i32, REP_STATE_INDEX);
  }
}
