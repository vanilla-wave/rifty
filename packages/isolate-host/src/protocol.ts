/**
 * Parent ↔ child wire (ADR-0557 §6). Parent → child: one JSON `RunRequest` line on
 * the child's stdin (the child trusts its parent). Child → parent: length-framed
 * binary frames on fd 3, parsed by the parent itself — no Node IPC deserializer
 * between a possibly escaped child and the consumer.
 *
 * Frame: u32be payload length, u8 kind, payload.
 *   output: [fd 1|2][truncated 0|1][bytes…]   exit: [code]
 *   memory: (empty)                            error: utf8 text (≤ MAX_ERROR_TEXT)
 *
 * Truncation rides output frames only (a flip with no new bytes is its own
 * frame): a terminal frame is always preceded by the flush of what came before.
 */
export interface RunRequest {
  readonly code: string;
  readonly memoryLimitMb: number;
  readonly maxRssBytes: number;
  readonly maxOutputBytes: number;
}

export const FRAME_CHANNEL_FD = 3;
export const MAX_ERROR_TEXT = 4096;
export const KIND = { output: 1, exit: 2, memory: 3, error: 4 } as const;
const HEADER = 5;

export function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER + payload.byteLength);
  new DataView(out.buffer).setUint32(0, payload.byteLength);
  out[4] = kind;
  out.set(payload, HEADER);
  return out;
}

export type ChildFrame =
  | {
      readonly kind: 'output';
      readonly fd: 1 | 2;
      readonly truncated: boolean;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: 'exit'; readonly exitCode: number }
  | { readonly kind: 'memory' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Incremental parser for untrusted child frames. A header announcing more than
 * the frame may legally carry is refused before its payload is buffered, so
 * the parser holds at most one legal frame (≤ output room + 7 bytes).
 */
export class FrameReader {
  #buf = new Uint8Array(0);
  #len = 0;
  #done = false;
  /** `maxPayload(kind)` → the largest payload this kind may legally have now, or -1 for an unknown kind. */
  constructor(private readonly maxPayload: (kind: number) => number) {}

  /**
   * Feed bytes, handing each complete frame to `onFrame` as it is parsed, so
   * parsing and handling interleave: once `onFrame` returns false the run is
   * settled and every later byte is ignored. Returns a violation, or null.
   */
  push(chunk: Uint8Array, onFrame: (kind: number, payload: Uint8Array) => boolean): string | null {
    if (this.#done) return null;
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
      const max = this.maxPayload(kind);
      if (max < 0) return `frame kind ${kind}`;
      // Refused before buffering its payload: the reader never holds an illegal frame.
      if (length > max) return `frame length ${length} > ${max}`;
      if (this.#len - at - HEADER < length) break;
      // Copy: nothing handed out aliases the reader's buffer.
      const payload = this.#buf.slice(at + HEADER, at + HEADER + length);
      at += HEADER + length;
      if (!onFrame(kind, payload)) {
        this.#done = true;
        this.#buf = new Uint8Array(0);
        this.#len = 0;
        return null;
      }
    }
    this.#buf.copyWithin(0, at, this.#len);
    this.#len -= at;
    if (this.#buf.byteLength > 4096 && this.#len < this.#buf.byteLength / 4) {
      this.#buf = this.#buf.slice(0, Math.max(this.#len, 64));
    }
    return null;
  }
}
