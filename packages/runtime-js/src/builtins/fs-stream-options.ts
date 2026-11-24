/**
 * Option, chunk and flag validation for `fs-streams.ts` (Node's synchronous
 * create/write-time checks); split out of it at its size ratchet.
 */

import { NotImplementedError } from '@riftydev/io';
import { Buffer } from './buffer.ts';

export interface ReadStreamOptions {
  flags?: string;
  encoding?: string;
  fd?: unknown;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  end?: number;
  highWaterMark?: number;
  fs?: unknown;
  signal?: AbortSignal;
}

export interface WriteStreamOptions {
  flags?: string;
  encoding?: string;
  fd?: unknown;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  highWaterMark?: number;
  fs?: unknown;
  signal?: AbortSignal;
}

/**
 * Node's string-options overload + option-shape validation, ONE boundary for
 * both factories (review 2026-07-06: `createReadStream(path, 'utf8')` was
 * silently treated as no options — Buffers where Node emits strings;
 * `createWriteStream(path, 'base64')` wrote utf8 where Node decodes base64).
 * Node (probed v24): string → `{ encoding }`; null/undefined → defaults; any
 * other non-object → ERR_INVALID_ARG_TYPE; an unknown encoding VALUE →
 * ERR_INVALID_ARG_VALUE — all SYNCHRONOUS at create time.
 */
export function normalizeStreamOptions<T extends ReadStreamOptions | WriteStreamOptions>(
  opts: T | string | null | undefined,
): T {
  if (opts === undefined || opts === null) return {} as T;
  if (typeof opts === 'string') {
    assertKnownEncoding(opts);
    return { encoding: opts } as T;
  }
  if (typeof opts !== 'object') {
    throw Object.assign(
      new TypeError(
        `The "options" argument must be one of type string or object. Received ${receivedText(opts)}`,
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  if (opts.encoding !== undefined && opts.encoding !== null) assertKnownEncoding(opts.encoding);
  return opts;
}

function assertKnownEncoding(encoding: string): void {
  if (!Buffer.isEncoding(encoding)) {
    throw Object.assign(
      new TypeError(`The argument 'encoding' is invalid encoding. Received '${encoding}'`),
      { code: 'ERR_INVALID_ARG_VALUE' },
    );
  }
}

/** Reject Node option fields this implementation cannot honor — loudly. */
export function assertSupportedStreamOptions(
  opts: ReadStreamOptions | WriteStreamOptions,
  surface: string,
  extra: readonly (keyof ReadStreamOptions & keyof WriteStreamOptions)[] = [],
): void {
  if (opts.fd !== undefined && opts.fd !== null) throw new NotImplementedError(`${surface}.fd`);
  if (opts.fs !== undefined && opts.fs !== null) throw new NotImplementedError(`${surface}.fs`);
  if (opts.autoClose === false) throw new NotImplementedError(`${surface}.autoClose:false`);
  for (const key of extra) {
    if (opts[key] !== undefined) throw new NotImplementedError(`${surface}.${key}`);
  }
}

/**
 * Node validates the window SYNCHRONOUSLY at createReadStream with
 * ERR_OUT_OF_RANGE for negatives/non-integers. `highWaterMark: 0` is VALID in
 * Node (yields an empty stream + immediate 'end'; verified 2026-07-05) — it is
 * handled explicitly in `start()`, never forwarded to the VFS (whose
 * `chunkSize: 0` is a RangeError).
 */
export function assertStreamRange(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw Object.assign(
      new RangeError(`The value of "${name}" is out of range. Received ${value}`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
}

/** Node's ERR_INVALID_ARG_TYPE "Received …" rendering for the common shapes. */
export function receivedText(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object' || typeof value === 'function') {
    const name = (value as object).constructor?.name;
    return name ? `an instance of ${name}` : `type ${typeof value}`;
  }
  return `type ${typeof value} (${String(value)})`;
}

export function assertValidChunk(chunk: unknown): asserts chunk is string | ArrayBufferView {
  if (typeof chunk !== 'string' && !ArrayBuffer.isView(chunk)) {
    // Node throws SYNCHRONOUSLY — an invalid chunk is a programming error, and
    // the old array-like overlay of a function chunk minted a NUL byte into
    // the file (review 2026-07-05). Any TypedArray/DataView is VALID (its raw
    // bytes land) — the old string|Uint8Array gate rejected them (handoff #6).
    throw Object.assign(
      new TypeError(
        `The "chunk" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${receivedText(chunk)}`,
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
}

/** Raw-bytes view over any TypedArray/DataView chunk (no copy). */
export function chunkBytes(chunk: ArrayBufferView): Uint8Array {
  return chunk instanceof Uint8Array
    ? chunk
    : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

export interface ParsedStreamFlags {
  readonly append: boolean;
  readonly exclusive: boolean;
  readonly truncate: boolean;
  readonly mustExist: boolean;
}

export function parseWriteFlags(flags: string, surface: string): ParsedStreamFlags {
  switch (flags) {
    case 'w':
    case 'w+':
      return { append: false, exclusive: false, truncate: true, mustExist: false };
    case 'wx':
    case 'xw':
    case 'wx+':
    case 'xw+':
      return { append: false, exclusive: true, truncate: true, mustExist: false };
    case 'a':
    case 'a+':
      return { append: true, exclusive: false, truncate: false, mustExist: false };
    case 'ax':
    case 'xa':
    case 'ax+':
    case 'xa+':
      return { append: true, exclusive: true, truncate: false, mustExist: false };
    case 'r+':
      return { append: false, exclusive: false, truncate: false, mustExist: true };
    default:
      throw new NotImplementedError(`${surface}.flags:'${flags}'`);
  }
}
