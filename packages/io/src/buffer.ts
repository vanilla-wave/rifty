/**
 * Node-compatible `node:buffer` — Buffer factory + statics, owned by
 * `@rifty/io` per ADR-0012.
 *
 * Node's Buffer extends Uint8Array. We use a static factory pattern (`Buffer.from`,
 * `Buffer.alloc`) and return Uint8Array instances tagged with Buffer-style helpers
 * via prototype patching. Per-instance method definitions live in
 * `./buffer-methods.ts`; encoding helpers in `./buffer-codec.ts`.
 *
 * What we cover: from(string/array/ArrayBuffer/Uint8Array), alloc, concat,
 * byteLength, toString('utf8'|'hex'|'base64'), isBuffer, equals, write,
 * read/write{Int,UInt}{8,16,32}{BE,LE}, read/write{Big}{Int,UInt}64{BE,LE},
 * swap{16,32,64}, compare (instance + static).
 *
 * Not covered yet (add when a real package needs them):
 * read/writeFloat{BE,LE}, read/writeDouble{BE,LE}, indexOf/includes, fill,
 * copy, copyWithin overloads.
 */

import { type Encoding, compareSlices, encode } from './buffer-codec.ts';
import { BUFFER_TAG, type BufferMethods, tag } from './buffer-methods.ts';

export type { BufferMethods, Encoding };

export type Buffer = Uint8Array & BufferMethods;
export type BufferLike = Buffer;

function alloc(size: number, fill?: number | string, _encoding?: Encoding): Buffer {
  const u8 = new Uint8Array(size);
  if (fill !== undefined) {
    if (typeof fill === 'number') u8.fill(fill);
    else u8.set(encode(fill, 'utf8'));
  }
  return tag(u8);
}

function allocUnsafe(size: number): Buffer {
  return tag(new Uint8Array(size));
}

function from(
  value: string | ArrayBuffer | ArrayLike<number> | Uint8Array,
  encodingOrOffset?: Encoding | number,
  length?: number,
): Buffer {
  if (typeof value === 'string') {
    return tag(encode(value, (encodingOrOffset as Encoding) ?? 'utf8'));
  }
  if (value instanceof Uint8Array) {
    return tag(new Uint8Array(value));
  }
  if (value instanceof ArrayBuffer) {
    const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
    return tag(new Uint8Array(value, offset, length));
  }
  return tag(new Uint8Array(value));
}

function concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
  let len = totalLength;
  if (len === undefined) {
    len = 0;
    for (const a of list) len += a.length;
  }
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of list) {
    const remaining = len - offset;
    const take = a.subarray(0, Math.min(a.length, remaining));
    out.set(take, offset);
    offset += take.length;
    if (offset >= len) break;
  }
  return tag(out);
}

function byteLength(s: string, encoding: Encoding = 'utf8'): number {
  return encode(s, encoding).length;
}

function isBuffer(v: unknown): boolean {
  return Boolean(v && (v as { [k: symbol]: unknown })[BUFFER_TAG]);
}

function compare(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  return compareSlices(a, b);
}

export const Buffer = {
  alloc,
  allocUnsafe,
  from,
  concat,
  byteLength,
  isBuffer,
  compare,
} as const;
export default { Buffer };
