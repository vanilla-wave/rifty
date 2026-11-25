/**
 * ADR-0573: one instance of `zlib.wasm` (Node v24.16.0 deps/zlib, generated/) and checked access to
 * its linear memory. Exports are i32: pointers ≥ 2 GiB come back negative (`>>> 0`); any call may
 * grow memory and detach views, so every access builds a fresh view.
 */

interface ZlibExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(ptr: number): void;
  zlibVersion(): number;
  deflateInit2_(
    strm: number,
    level: number,
    method: number,
    windowBits: number,
    memLevel: number,
    strategy: number,
    version: number,
    streamSize: number,
  ): number;
  inflateInit2_(strm: number, windowBits: number, version: number, streamSize: number): number;
  deflate(strm: number, flush: number): number;
  inflate(strm: number, flush: number): number;
  deflateEnd(strm: number): number;
  inflateEnd(strm: number): number;
  deflateReset(strm: number): number;
  inflateReset(strm: number): number;
  deflateParams(strm: number, level: number, strategy: number): number;
  deflateSetDictionary(strm: number, dict: number, length: number): number;
  inflateSetDictionary(strm: number, dict: number, length: number): number;
  crc32(crc: number, buf: number, length: number): number;
}

/** `zlib.wasm` did not compile or instantiate: no fallback engine exists. */
export class ZlibEngineError extends Error {
  constructor(cause: unknown) {
    super(`zlib.wasm failed to load: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'ZlibEngineError';
  }
}

/** wasm32 z_stream: 14 × 4 bytes. */
export const Z_STREAM_SIZE = 56;
/** z_stream field offsets (zlib.h order). */
export const ZS = {
  nextIn: 0,
  availIn: 4,
  nextOut: 12,
  availOut: 16,
  msg: 24,
} as const;

export class ZlibEngine {
  readonly x: ZlibExports;
  /** `zlibVersion()` — the pointer deflateInit2_/inflateInit2_ check against. */
  readonly version: number;

  constructor(bytes: Uint8Array) {
    try {
      const module = new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
      this.x = new WebAssembly.Instance(module, {}).exports as unknown as ZlibExports;
      this.x._initialize();
    } catch (cause) {
      throw new ZlibEngineError(cause);
    }
    this.version = this.x.zlibVersion();
  }

  /** Never 0: an exhausted wasm space is a loud RangeError, not a write at address 0. */
  malloc(size: number): number {
    const ptr = this.x.malloc(size) >>> 0;
    if (ptr === 0) throw new RangeError(`zlib.wasm: malloc(${size}) failed: wasm memory exhausted`);
    return ptr;
  }

  free(ptr: number): void {
    this.x.free(ptr);
  }

  /** Copy bytes into a fresh allocation (≥ 1 byte, so an empty input still has an address). */
  copyIn(bytes: Uint8Array): number {
    const ptr = this.malloc(Math.max(bytes.byteLength, 1));
    this.heap().set(bytes, ptr);
    return ptr;
  }

  heap(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer);
  }

  u32(ptr: number): number {
    return new DataView(this.x.memory.buffer).getUint32(ptr, true);
  }

  setU32(ptr: number, value: number): void {
    new DataView(this.x.memory.buffer).setUint32(ptr, value, true);
  }

  /** NUL-terminated Latin-1 string (zlib's messages are ASCII), or null at address 0. */
  cstring(ptr: number): string | null {
    if (ptr === 0) return null;
    const heap = this.heap();
    let end = ptr;
    while (heap[end] !== 0) end++;
    return String.fromCharCode(...heap.subarray(ptr, end));
  }

  crc32(bytes: Uint8Array, value: number): number {
    const ptr = this.copyIn(bytes);
    try {
      return this.x.crc32(value, ptr, bytes.byteLength) >>> 0;
    } finally {
      this.free(ptr);
    }
  }
}
