/**
 * SAB request/reply ring (ADR-0011 phase 1, version field per ADR-0032).
 *
 * Byte layout:
 * ```
 *   ┌────────────┬───────────┬───────────────────────────────────────────┐
 *   │  0 ..   4  │ VERSION   │ Int32; SyncRpc protocol version (ADR-0032)│
 *   │  4 ..   8  │ REQ_STATE │ Int32; 0 = idle, 1 = request-pending      │
 *   │  8 ..  12  │ REP_STATE │ Int32; 0 = no-reply, 1 = reply-ready      │
 *   │ 12 ..  16  │ REQ_LEN   │ Int32; request payload length in bytes    │
 *   │ 16 ..  20  │ REP_LEN   │ Int32; reply payload length in bytes      │
 *   │ 20 .. 20+C │ REQ_PAY   │ request payload (C = payloadCapacity)     │
 *   │20+C..20+2C │ REP_PAY   │ reply payload                             │
 *   └────────────┴───────────┴───────────────────────────────────────────┘
 * ```
 *
 * Wait-notify slots: REQ_STATE/REP_STATE. VERSION (ADR-0032) is stamped by
 * every `writeRequest`/`writeReply` and validated by every
 * `readRequest`/`consumeReply`; mismatched frames throw
 * {@link SyncRpcProtocolMismatchError} before payload is decoded.
 *
 * Single-request-at-a-time. Caller writes a request and blocks via
 * `waitReply`; responder reads via `readRequest` and answers via
 * `writeReply`. Multi-in-flight pipelining is out of scope per ADR-0011.
 */

import { SYNC_RPC_PROTOCOL_VERSION, SyncRpcProtocolMismatchError } from './sync-rpc.ts';

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
function atomicsWaitAsync(ia: Int32Array, i: number, v: number, t: number): WaitAsyncResult {
  return (Atomics as unknown as AtomicsWithWaitAsync).waitAsync(ia, i, v, t);
}

export const SAB_RING_HEADER_BYTES = 20;
export const VERSION_OFFSET = 0;
export const REQ_STATE_OFFSET = 4;
export const REP_STATE_OFFSET = 8;
export const REQ_LEN_OFFSET = 12;
export const REP_LEN_OFFSET = 16;
export const DEFAULT_PAYLOAD_CAPACITY = 1024 * 1024; // 1 MiB

const STATE_IDLE = 0;
const STATE_READY = 1;
export const VERSION_INDEX = VERSION_OFFSET >> 2;
const REQ_STATE_INDEX = REQ_STATE_OFFSET >> 2;
const REP_STATE_INDEX = REP_STATE_OFFSET >> 2;
const REQ_LEN_INDEX = REQ_LEN_OFFSET >> 2;
const REP_LEN_INDEX = REP_LEN_OFFSET >> 2;

/** Compile-time documentation of the header layout; useful for consumers. */
export interface SabRingHeader {
  readonly VERSION: typeof VERSION_OFFSET;
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
  /** Expected SyncRpc protocol version (ADR-0032). Defaults to
   * {@link SYNC_RPC_PROTOCOL_VERSION}; only tests should override. */
  expectedVersion?: number;
}

export interface CreateSabRingResult {
  readonly sab: SharedArrayBuffer;
  readonly ring: SabRing;
}

/** Allocates a new {@link SharedArrayBuffer} sized for a single ring and
 * returns the buffer (to transfer to another realm) plus a local
 * {@link SabRing}. Peers attach via {@link SabRing.attach}. */
export function createSabRing(opts: CreateSabRingOptions = {}): CreateSabRingResult {
  const payloadCapacity = opts.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY;
  if (!Number.isInteger(payloadCapacity) || payloadCapacity <= 0) {
    throw new RangeError(
      `createSabRing: payloadCapacity must be a positive integer, got ${payloadCapacity}`,
    );
  }
  const totalBytes = SAB_RING_HEADER_BYTES + payloadCapacity * 2;
  const sab = new SharedArrayBuffer(totalBytes);
  return {
    sab,
    ring: SabRing.attach(sab, payloadCapacity, { expectedVersion: opts.expectedVersion }),
  };
}

/** Options accepted by {@link SabRing.attach}. */
export interface AttachSabRingOptions {
  /** Expected SyncRpc protocol version (ADR-0032). Defaults to
   * {@link SYNC_RPC_PROTOCOL_VERSION}. */
  expectedVersion?: number;
}

/** Wrapper around a {@link SharedArrayBuffer} implementing the
 * request/reply protocol. The same class is used on both peers — role is
 * determined by which methods you invoke. {@link writeRequest} +
 * {@link waitReply} are caller-side; {@link readRequest} +
 * {@link writeReply} are responder-side. */
export class SabRing {
  private readonly i32: Int32Array;
  private readonly bytes: Uint8Array;
  readonly payloadCapacity: number;
  readonly reqPayloadOffset: number;
  readonly repPayloadOffset: number;
  readonly header: SabRingHeader;
  /** Protocol version this peer expects on every incoming frame (ADR-0032). */
  readonly expectedVersion: number;

  private constructor(sab: SharedArrayBuffer, payloadCapacity: number, expectedVersion: number) {
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
    this.expectedVersion = expectedVersion;
    this.header = {
      VERSION: VERSION_OFFSET,
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

  /** Attaches a {@link SabRing} to an existing {@link SharedArrayBuffer}.
   * Both peers must agree on `payloadCapacity`. `expectedVersion`
   * (ADR-0032) defaults to {@link SYNC_RPC_PROTOCOL_VERSION}. */
  static attach(
    sab: SharedArrayBuffer,
    payloadCapacity: number = DEFAULT_PAYLOAD_CAPACITY,
    opts: AttachSabRingOptions = {},
  ): SabRing {
    const expectedVersion = opts.expectedVersion ?? SYNC_RPC_PROTOCOL_VERSION;
    return new SabRing(sab, payloadCapacity, expectedVersion);
  }

  /** Caller-side: copy `payload` into the request slot, stamp VERSION with
   * {@link expectedVersion} (ADR-0032), and wake the responder. Throws
   * {@link RingPayloadTooLargeError} on oversize; throws if a previous
   * reply/request is still unread. */
  writeRequest(payload: Uint8Array): void {
    this.writeRequestWithVersion(payload, this.expectedVersion);
  }

  /** Test/diagnostic hook: write a request with an explicit version
   * stamp. Production code uses {@link writeRequest}. (ADR-0032) */
  writeRequestWithVersion(payload: Uint8Array, version: number): void {
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
    // VERSION stamped before STATE flip so the responder sees a consistent header.
    Atomics.store(this.i32, VERSION_INDEX, version);
    Atomics.store(this.i32, REQ_STATE_INDEX, STATE_READY);
    Atomics.notify(this.i32, REQ_STATE_INDEX);
  }

  /** Caller-side: sync block on reply via `Atomics.wait` (Worker realm
   * only). Throws {@link RingTimeoutError} on timeout,
   * {@link SyncRpcProtocolMismatchError} on version mismatch (ADR-0032). */
  waitReply(timeoutMs?: number): Uint8Array {
    const timeout = timeoutMs ?? Number.POSITIVE_INFINITY;
    const result = Atomics.wait(this.i32, REP_STATE_INDEX, STATE_IDLE, timeout);
    if (result === 'timed-out') throw new RingTimeoutError(timeout);
    return this.consumeReply();
  }

  /** Async sibling of {@link waitReply} — awaitable from any realm via
   * `Atomics.waitAsync`. Not part of the production caller API. */
  async waitReplyAsync(timeoutMs?: number): Promise<Uint8Array> {
    const timeout = timeoutMs ?? Number.POSITIVE_INFINITY;
    const pending = atomicsWaitAsync(this.i32, REP_STATE_INDEX, STATE_IDLE, timeout);
    const result = pending.async ? await pending.value : pending.value;
    if (result === 'timed-out') throw new RingTimeoutError(timeout);
    return this.consumeReply();
  }

  private consumeReply(): Uint8Array {
    // Snapshot VERSION first, then clear state; the throw must not wedge the ring (ADR-0032).
    const version = Atomics.load(this.i32, VERSION_INDEX);
    const len = Atomics.load(this.i32, REP_LEN_INDEX);
    Atomics.store(this.i32, REP_LEN_INDEX, 0);
    Atomics.store(this.i32, REP_STATE_INDEX, STATE_IDLE);
    if (version !== this.expectedVersion) {
      throw new SyncRpcProtocolMismatchError(this.expectedVersion, version);
    }
    if (len < 0 || len > this.payloadCapacity) {
      throw new Error(`SabRing: corrupt reply length ${len} (capacity ${this.payloadCapacity})`);
    }
    const out = new Uint8Array(len);
    out.set(this.bytes.subarray(this.repPayloadOffset, this.repPayloadOffset + len));
    return out;
  }

  /** Responder-side: non-blocking. Returns the request payload bytes (a
   * fresh copy) when pending, or `null`. Clears REQ_STATE on success.
   * Throws {@link SyncRpcProtocolMismatchError} on version mismatch —
   * recoverable: state is cleared, the responder should reply via
   * {@link writeReplyWithVersion} echoing the caller's version (ADR-0032). */
  readRequest(): Uint8Array | null {
    if (Atomics.load(this.i32, REQ_STATE_INDEX) !== STATE_READY) return null;
    // Snapshot VERSION first, then clear state; the throw must not wedge the ring (ADR-0032).
    const version = Atomics.load(this.i32, VERSION_INDEX);
    const len = Atomics.load(this.i32, REQ_LEN_INDEX);
    Atomics.store(this.i32, REQ_LEN_INDEX, 0);
    Atomics.store(this.i32, REQ_STATE_INDEX, STATE_IDLE);
    if (version !== this.expectedVersion) {
      throw new SyncRpcProtocolMismatchError(this.expectedVersion, version);
    }
    if (len < 0 || len > this.payloadCapacity) {
      throw new Error(`SabRing: corrupt request length ${len} (capacity ${this.payloadCapacity})`);
    }
    const out = new Uint8Array(len);
    out.set(this.bytes.subarray(this.reqPayloadOffset, this.reqPayloadOffset + len));
    return out;
  }

  /** Responder-side: write reply bytes, stamp VERSION with
   * {@link expectedVersion} (ADR-0032), and notify the caller. */
  writeReply(payload: Uint8Array): void {
    this.writeReplyWithVersion(payload, this.expectedVersion);
  }

  /** Test/diagnostic hook + recovery path for version mismatch — the
   * dispatcher echoes the caller's version back inside an error reply so
   * the caller can still decode the failure (ADR-0032). */
  writeReplyWithVersion(payload: Uint8Array, version: number): void {
    if (payload.byteLength > this.payloadCapacity) {
      throw new RingPayloadTooLargeError(payload.byteLength, this.payloadCapacity);
    }
    if (Atomics.load(this.i32, REP_STATE_INDEX) !== STATE_IDLE) {
      throw new Error('SabRing: cannot writeReply while a previous reply is unread');
    }
    this.bytes.set(payload, this.repPayloadOffset);
    Atomics.store(this.i32, REP_LEN_INDEX, payload.byteLength);
    Atomics.store(this.i32, VERSION_INDEX, version);
    Atomics.store(this.i32, REP_STATE_INDEX, STATE_READY);
    Atomics.notify(this.i32, REP_STATE_INDEX);
  }
}
