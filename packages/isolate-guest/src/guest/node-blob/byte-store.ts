/**
 * `internalBinding('blob')` of Node v24.16.0 as a JS byte store (ADR-0578 §2). A handle is a list
 * of entries, as Node's `DataQueue`: a part (`blob.js`'s own copy, whose buffer the store takes
 * over, detaching it as Node does) or a source blob's handle, kept nested; `slice` keeps views
 * and nested slices, copying nothing. A reader pulls synchronously, as Node's in-memory reads:
 * a part gives its bytes, the end of an entry gives a read without bytes unless it ends its queue
 * (measured against live Node: `arrayBuffer()` of `p` parts settles after `2p − 1` reads).
 * Every intrinsic is captured at bundle load; no guest-replaceable lookup.
 */
import { notImplemented } from '../loud.ts';

type Fn = (...args: never[]) => unknown;
const apply = Reflect.apply;
const getter = (proto: object, key: string) =>
  Object.getOwnPropertyDescriptor(proto, key)?.get as Fn;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const Uint8ArrayPrimordial = Uint8Array;
const subarray = Uint8Array.prototype.subarray;
const setBytes = Uint8Array.prototype.set;
const byteLengthOf = getter(TypedArrayPrototype, 'byteLength');
const byteOffsetOf = getter(TypedArrayPrototype, 'byteOffset');
const bufferOf = getter(TypedArrayPrototype, 'buffer');
const arrayBufferByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const sliceBuffer = ArrayBuffer.prototype.slice;
// ES2024: the isolate's V8 (Node 24's) has it; without it a part is copied instead of taken over.
const transferBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'transfer')?.value as
  | Fn
  | undefined;
const push = Array.prototype.push;
const pop = Array.prototype.pop;
const MathMax = Math.max;
const MathMin = Math.min;

const STATUS_EOS = 0;
const STATUS_CONTINUE = 1;

type Entry = Uint8Array | BlobHandle;
type Pull = (status: number, chunk?: ArrayBuffer) => void;

let isHandle: (value: unknown) => value is BlobHandle;
let entriesOf: (handle: BlobHandle) => readonly Entry[];
let lengthOf: (entry: Entry) => number;

/** A blob's entries; never mutated after construction, never handed to guest code. */
class BlobHandle {
  readonly #entries: readonly Entry[];
  readonly #length: number;
  constructor(entries: readonly Entry[]) {
    let length = 0;
    for (let i = 0; i < entries.length; i++) length += lengthOf(entries[i] as Entry);
    this.#entries = entries;
    this.#length = length;
  }
  /** Node's handle `slice(start, end)`: bounds already clamped by `blob.js`. */
  slice(start: number, end: number): BlobHandle {
    const out: Entry[] = [];
    if (end <= start) return new BlobHandle(out);
    const entries = this.#entries;
    let at = 0;
    for (let i = 0; i < entries.length && at < end; i++) {
      const entry = entries[i] as Entry;
      const length = lengthOf(entry);
      // Node's DataQueue starts at the first entry ending at or after `start` (one ending exactly
      // there stays, empty) and keeps every entry starting before `end`.
      if (at + length >= start) {
        const from = MathMax(start - at, 0);
        const to = MathMin(end - at, length);
        apply(push, out, [
          isHandle(entry) ? entry.slice(from, to) : apply(subarray, entry, [from, to]),
        ]);
      }
      at += length;
    }
    return new BlobHandle(out);
  }
  getReader(): BlobReader {
    return new BlobReader(this);
  }
  static {
    isHandle = (value): value is BlobHandle =>
      typeof value === 'object' && value !== null && #entries in value;
    entriesOf = (handle) => handle.#entries;
    lengthOf = (entry) =>
      isHandle(entry) ? entry.#length : (apply(byteLengthOf, entry, []) as number);
  }
}

/** A queue being read: its entries and the next one. */
interface Frame {
  readonly entries: readonly Entry[];
  next: number;
}

class BlobReader {
  readonly #stack: Frame[];
  /** A part was handed out; its end is the next read. */
  #partOut = false;
  constructor(handle: BlobHandle) {
    this.#stack = [{ entries: entriesOf(handle), next: 0 }];
  }
  pull(callback: Pull): void {
    const stack = this.#stack;
    let ended = this.#partOut;
    this.#partOut = false;
    for (;;) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        callback(STATUS_EOS);
        return;
      }
      if (ended || frame.next >= frame.entries.length) {
        // An entry ended: a read without bytes, unless it was its queue's last.
        if (frame.next < frame.entries.length) {
          callback(STATUS_CONTINUE);
          return;
        }
        apply(pop, stack, []);
        ended = true;
        continue;
      }
      const entry = frame.entries[frame.next++] as Entry;
      if (isHandle(entry)) {
        apply(push, stack, [{ entries: entriesOf(entry), next: 0 }]);
        continue;
      }
      this.#partOut = true;
      // A copy, as Node's reader hands out: the part stays the blob's own.
      const offset = apply(byteOffsetOf, entry, []) as number;
      const length = apply(byteLengthOf, entry, []) as number;
      callback(
        STATUS_CONTINUE,
        apply(sliceBuffer, apply(bufferOf, entry, []), [offset, offset + length]) as ArrayBuffer,
      );
      return;
    }
  }
  /** Only `stream()` registers one; `stream()` is the `ReadableStream` gap. */
  setWakeup(): void {}
}

/** The part's bytes, owned by the store: its buffer taken over (detached, as Node), else copied. */
function own(view: Uint8Array): Uint8Array {
  const buffer = apply(bufferOf, view, []) as ArrayBuffer;
  const offset = apply(byteOffsetOf, view, []) as number;
  const length = apply(byteLengthOf, view, []) as number;
  if (transferBuffer !== undefined) {
    try {
      return new Uint8ArrayPrimordial(
        apply(transferBuffer, buffer, []) as ArrayBuffer,
        offset,
        length,
      );
    } catch {
      // Not detachable (a SharedArrayBuffer, a wasm memory): a copy.
    }
  }
  return new Uint8ArrayPrimordial(
    apply(sliceBuffer, buffer, [offset, offset + length]) as ArrayBuffer,
  );
}

/** Node's `createBlob(sources, length)`: `blob.js`'s own part copies or source handles. */
function createBlob(sources: readonly unknown[], _length: number): BlobHandle {
  const entries: Entry[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    apply(push, entries, [isHandle(source) ? source : own(source as Uint8Array)]);
  }
  return new BlobHandle(entries);
}

/** Node's `concat(chunks)`: one `ArrayBuffer` holding every chunk in order. */
function concat(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  // A single chunk is already a fresh copy no one else holds.
  if (chunks.length === 1) return chunks[0] as ArrayBuffer;
  let total = 0;
  for (let i = 0; i < chunks.length; i++)
    total += apply(arrayBufferByteLength, chunks[i], []) as number;
  const out = new Uint8ArrayPrimordial(total);
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as ArrayBuffer;
    apply(setBytes, out, [new Uint8ArrayPrimordial(chunk), at]);
    at += apply(arrayBufferByteLength, chunk, []) as number;
  }
  return apply(bufferOf, out, []) as ArrayBuffer;
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
