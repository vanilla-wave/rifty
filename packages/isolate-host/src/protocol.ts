/**
 * Consumer ↔ worker wire (ADR-0557 §6, pool ADR). Consumer → worker: JSON lines
 * on the worker's stdin (the worker trusts its consumer). Worker → consumer:
 * length-framed binary frames on fd 3, parsed by the consumer itself — no Node
 * IPC deserializer between a possibly escaped worker and the consumer.
 *
 * Frame: u32be payload length, u8 kind, u32be call, payload.
 *   output: [fd 1|2][truncated 0|1][bytes…]   exit: [code]
 *   memory: (empty)   error: utf8 text (≤ MAX_ERROR_TEXT)
 *   retire: (empty, call 0) — send this worker no new call
 *
 * Per call: output frames, then exactly one terminal frame (exit, memory or
 * error); for a call the consumer cancelled it only ends its addressing. Truncation rides output frames only
 * (a flip with no new bytes is its own frame): a terminal frame is always
 * preceded by the flush of what came before.
 */
export interface RunRequest {
  readonly type: 'run';
  readonly call: number;
  readonly code: string;
  readonly memoryLimitMb: number;
  readonly maxOutputBytes: number;
  /** Set on a solo worker's only call: the worker's exhaustion is attributed to it. */
  readonly solo?: true;
}

/** The consumer settled `call` at its deadline: dispose its isolate. */
export interface CancelRequest {
  readonly type: 'cancel';
  readonly call: number;
}

export type WorkerRequest = RunRequest | CancelRequest;

export const FRAME_CHANNEL_FD = 3;
export const MAX_ERROR_TEXT = 4096;
export const KIND = { output: 1, exit: 2, memory: 3, error: 4, retire: 5 } as const;
export const HEADER = 9;
/** Calls the consumer places on one worker at once (pool ADR). */
export const SHARD = 4;
/** A disposed isolate still running after this retires its worker (pool ADR). */
export const STUCK_GRACE_MS = 1000;
/** An idle worker above this RSS retires; it is also the RSS base each call's allowance adds to. */
export const RECYCLE_RSS_BYTES = 256 * 1024 * 1024;

/** The worker's RSS ceiling for calls with these memory limits: 256 MiB + 3 × the sum (ADR-0557 §3, summed). */
export function rssCeilingBytes(memoryLimitsMb: Iterable<number>): number {
  let sum = 0;
  for (const mb of memoryLimitsMb) sum += mb;
  return RECYCLE_RSS_BYTES + 3 * sum * 1024 * 1024;
}

export function frame(kind: number, call: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.byteLength);
  out[4] = kind;
  view.setUint32(5, call);
  out.set(payload, HEADER);
  return out;
}

/**
 * Incremental parser for untrusted worker frames. A header announcing more than
 * the frame may legally carry — or a call/kind the consumer refuses — is
 * refused before its payload is buffered, so the parser holds at most one legal
 * frame.
 */
export class FrameReader {
  #buf = new Uint8Array(0);
  #len = 0;
  /** `maxPayload(kind, call)` → the largest payload this frame may legally have now, or a violation. */
  constructor(private readonly maxPayload: (kind: number, call: number) => number | string) {}

  /**
   * Feed bytes, handing each complete frame to `onFrame` as it is parsed, so
   * parsing and handling interleave (the caller ignores frames once it gave up
   * on the worker). Returns a violation, or null.
   */
  push(
    chunk: Uint8Array,
    onFrame: (kind: number, call: number, payload: Uint8Array) => string | undefined,
  ): string | null {
    if (this.#len + chunk.byteLength > this.#buf.byteLength) {
      const grown = new Uint8Array(
        Math.max(this.#len + chunk.byteLength, this.#buf.byteLength * 2, 64),
      );
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(chunk, this.#len);
    this.#len += chunk.byteLength;
    let at = 0;
    while (this.#len - at >= HEADER) {
      const view = new DataView(this.#buf.buffer, at, HEADER);
      const length = view.getUint32(0);
      const kind = view.getUint8(4);
      const call = view.getUint32(5);
      const max = this.maxPayload(kind, call);
      if (typeof max === 'string') return max;
      // Refused before buffering its payload: the reader never holds an illegal frame.
      if (length > max) return `frame length ${length} > ${max}`;
      if (this.#len - at - HEADER < length) break;
      // Copy: nothing handed out aliases the reader's buffer.
      const payload = this.#buf.slice(at + HEADER, at + HEADER + length);
      at += HEADER + length;
      const bad = onFrame(kind, call, payload);
      if (bad !== undefined) return bad;
    }
    this.#buf.copyWithin(0, at, this.#len);
    this.#len -= at;
    if (this.#buf.byteLength > 4096 && this.#len < this.#buf.byteLength / 4) {
      this.#buf = this.#buf.slice(0, Math.max(this.#len, 64));
    }
    return null;
  }
}
