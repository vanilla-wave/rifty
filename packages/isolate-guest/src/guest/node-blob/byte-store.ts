/**
 * `internalBinding('blob')` of Node v24.16.0 as a JS byte store (ADR-0578 §2): a handle is a list
 * of immutable parts — the `Uint8Array` copies `blob.js` makes, or the parts of a source blob —
 * and `slice` keeps views of them, copying nothing. A reader yields what Node's `DataQueue`
 * yields for in-memory parts (measured: `blob.arrayBuffer()` settles after `2p - 1` reads of `p`
 * parts): one read per part, one read with no bytes between two parts, then end of stream.
 * Synchronous, as Node's in-memory pull.
 */
import { notImplemented } from '../loud.ts';

const apply = Reflect.apply;
const Uint8ArrayPrimordial = Uint8Array;
const subarray = Uint8Array.prototype.subarray;
const set = Uint8Array.prototype.set;
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get as (this: Uint8Array) => number;
const bufferOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'buffer',
)?.get as (this: Uint8Array) => ArrayBuffer;
const sliceBuffer = ArrayBuffer.prototype.slice;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')
  ?.get as (this: ArrayBuffer) => number;
const byteOffsetOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteOffset',
)?.get as (this: Uint8Array) => number;
const push = Array.prototype.push;

const STATUS_EOS = 0;
const STATUS_CONTINUE = 1;

type Pull = (status: number, chunk?: ArrayBuffer) => void;

/** A handle's parts, for `createBlob` only (no member hands them to a guest holding a handle). */
let partsOf: (handle: BlobHandle) => readonly Uint8Array[];

/** The parts of a blob; never mutated after construction (a part is a view nobody else holds). */
class BlobHandle {
  readonly #parts: readonly Uint8Array[];
  constructor(parts: readonly Uint8Array[]) {
    this.#parts = parts;
  }
  /** Node's handle `slice(start, end)`: bounds already clamped by `blob.js`. */
  slice(start: number, end: number): BlobHandle {
    const out: Uint8Array[] = [];
    if (end <= start) return new BlobHandle(out);
    let at = 0;
    for (const part of this.#parts) {
      const length = apply(byteLengthOf, part, []);
      const partEnd = at + length;
      // Node's DataQueue starts at the first part ending at or after `start` (a part ending
      // exactly there stays as an empty view) and keeps every part starting before `end`.
      if (partEnd >= start && at < end) {
        const from = Math.max(start - at, 0);
        const to = Math.min(end - at, length);
        apply(push, out, [apply(subarray, part, [from, to])]);
      }
      at = partEnd;
      if (at >= end) break;
    }
    return new BlobHandle(out);
  }
  getReader(): BlobReader {
    return new BlobReader(this.#parts);
  }
  static {
    partsOf = (handle) => handle.#parts;
  }
}

class BlobReader {
  readonly #parts: readonly Uint8Array[];
  #next = 0;
  #between = false;
  constructor(parts: readonly Uint8Array[]) {
    this.#parts = parts;
  }
  pull(callback: Pull): void {
    if (this.#between) {
      this.#between = false;
      callback(STATUS_CONTINUE);
      return;
    }
    if (this.#next >= this.#parts.length) {
      callback(STATUS_EOS);
      return;
    }
    const part = this.#parts[this.#next++] as Uint8Array;
    this.#between = this.#next < this.#parts.length;
    // A copy, as Node's reader hands out: the part itself stays the blob's own.
    const offset = apply(byteOffsetOf, part, []);
    const chunk = apply(sliceBuffer, apply(bufferOf, part, []), [
      offset,
      offset + apply(byteLengthOf, part, []),
    ]) as ArrayBuffer;
    callback(STATUS_CONTINUE, chunk);
  }
  /** Only `stream()` registers one; `stream()` is the `ReadableStream` gap. */
  setWakeup(): void {}
}

/** Node's `createBlob(sources, length)`: `sources` are `blob.js`'s own copies or source handles. */
function createBlob(sources: readonly (Uint8Array | BlobHandle)[], _length: number): BlobHandle {
  const parts: Uint8Array[] = [];
  for (const source of sources) {
    if (source instanceof BlobHandle) apply(push, parts, partsOf(source));
    else apply(push, parts, [source]);
  }
  return new BlobHandle(parts);
}

/** Node's `concat(chunks)`: one new `ArrayBuffer` holding every chunk in order. */
function concat(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  if (chunks.length === 1) return chunks[0] as ArrayBuffer;
  let total = 0;
  for (const chunk of chunks) total += apply(arrayBufferByteLength, chunk, []);
  const out = new Uint8ArrayPrimordial(total);
  let at = 0;
  for (const chunk of chunks) {
    apply(set, out, [new Uint8ArrayPrimordial(chunk), at]);
    at += apply(arrayBufferByteLength, chunk, []);
  }
  return apply(bufferOf, out, []);
}

/** `internalBinding('blob')`; blob URLs and file-backed blobs are not reachable here. */
export const blobBinding = {
  createBlob,
  concat,
  // Only `resolveObjectURL` reads it; the guest's `buffer.resolveObjectURL` is rifty's gap, and no
  // blob URL is ever minted (`URL` is a ceiling).
  getDataObject(): never {
    throw notImplemented('isolate-host.blob-url', 'no blob URLs in the rifty isolate host');
  },
  // Only Node's `fs.openAsBlob` reads it; rifty's `openAsBlob` reads eagerly (ADR-0578 §5).
  createBlobFromFilePath(): never {
    throw notImplemented('isolate-host.file-backed-blob', 'rifty fs.openAsBlob reads eagerly');
  },
};
