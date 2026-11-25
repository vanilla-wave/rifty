/**
 * Drives the product handle (src/zlib-engine) exactly as Node v24.16.0 lib/zlib.js drives
 * `binding.Zlib` on its sync path: the Zlib() option mapping, `processChunkSync` with the persistent
 * output buffer (`_outOffset`), `zlibOnError` → destroy → `_close`, `params`/`reset`. Test-only: the
 * oracle is live `node:zlib`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZlibEngine } from '../../src/zlib-engine/engine';
import { type ZlibBinding, type ZlibHandle, createZlibBinding } from '../../src/zlib-engine/handle';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes';

export const NODE_FIXTURES = fileURLToPath(
  new URL('../fixtures/zlib-engine/node/', import.meta.url),
);

export const productBinding = (): ZlibBinding =>
  createZlibBinding(() => new ZlibEngine(zlibWasmBytes()), setImmediate);

export const MODES = {
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
} as const;
export type ModeName = keyof typeof MODES;

export interface StreamOpts {
  level?: number;
  windowBits?: number;
  memLevel?: number;
  strategy?: number;
  dictionary?: ArrayBufferView;
  chunkSize?: number;
  finishFlush?: number;
  flush?: number;
  maxOutputLength?: number;
}

const Z_FINISH = 4;

export class HandleStream {
  private handle: ZlibHandle | null;
  private readonly state = new Uint32Array(2);
  private readonly chunkSize: number;
  private outBuffer: Buffer;
  private outOffset = 0;
  private readonly maxOutputLength: number;
  readonly finishFlush: number;
  private error: Error | null = null;

  constructor(binding: ZlibBinding, mode: ModeName, opts: StreamOpts = {}) {
    const m = MODES[mode];
    const inflating = m === MODES.INFLATE || m === MODES.GUNZIP || m === MODES.UNZIP;
    const windowBits =
      (opts.windowBits == null || opts.windowBits === 0) && inflating ? 0 : (opts.windowBits ?? 15);
    this.chunkSize = opts.chunkSize ?? 16384;
    this.outBuffer = Buffer.allocUnsafe(this.chunkSize);
    this.maxOutputLength = opts.maxOutputLength ?? 2 ** 32;
    this.finishFlush = opts.finishFlush ?? Z_FINISH;
    const handle = new binding.Zlib(m);
    // zlibOnError: the error is the stream's, and destroy() closes the handle (pending mid-write).
    handle.onerror = (message, errno, code) => {
      this.error = Object.assign(new Error(message), { errno, code });
      this.close();
    };
    handle.init(
      windowBits,
      opts.level ?? -1,
      opts.memLevel ?? 8,
      opts.strategy ?? 0,
      this.state,
      () => {
        throw new Error('harness: async write callback on the sync path');
      },
      opts.dictionary,
    );
    this.handle = handle;
  }

  processChunkSync(chunk: Uint8Array, flushFlag: number): Buffer {
    let availInBefore = chunk.byteLength;
    let availOutBefore = this.chunkSize - this.outOffset;
    let inOff = 0;
    const buffers: Buffer[] = [];
    let nread = 0;
    let buffer = this.outBuffer;
    let offset = this.outOffset;
    const handle = this.handle;
    if (handle === null) throw new Error('zlib binding closed');
    for (;;) {
      handle.writeSync(flushFlag, chunk, inOff, availInBefore, buffer, offset, availOutBefore);
      if (this.error) throw this.error;
      const availOutAfter = this.state[0]!;
      const availInAfter = this.state[1]!;
      const inDelta = availInBefore - availInAfter;
      const have = availOutBefore - availOutAfter;
      if (have > 0) {
        const out = buffer.subarray(offset, offset + have);
        offset += have;
        buffers.push(Buffer.from(out));
        nread += have;
        if (nread > this.maxOutputLength) {
          this.close();
          throw Object.assign(
            new RangeError(`Cannot create a Buffer larger than ${this.maxOutputLength} bytes`),
            { code: 'ERR_BUFFER_TOO_LARGE' },
          );
        }
      }
      if (availOutAfter === 0 || offset >= this.chunkSize) {
        availOutBefore = this.chunkSize;
        offset = 0;
        buffer = Buffer.allocUnsafe(this.chunkSize);
      }
      if (availOutAfter === 0) {
        inOff += inDelta;
        availInBefore = availInAfter;
      } else break;
    }
    this.outBuffer = buffer;
    this.outOffset = offset;
    return Buffer.concat(buffers);
  }

  params(level: number, strategy: number): void {
    this.handle?.params(level, strategy);
    if (this.error) throw this.error;
  }

  reset(): void {
    if (this.handle === null) throw new Error('zlib binding closed');
    this.handle.reset();
    if (this.error) throw this.error;
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
  }
}

/** zlibBufferSync: one chunk with the finish flush, then `_close`. */
export function oneShotSync(
  binding: ZlibBinding,
  mode: ModeName,
  input: Uint8Array,
  opts: StreamOpts = {},
): Buffer {
  const s = new HandleStream(binding, mode, opts);
  try {
    return s.processChunkSync(input, s.finishFlush);
  } finally {
    s.close();
  }
}

/** The three Chromium-zlib sources the probe's corpus compresses (`zlibSrc`). */
export const zlibSourceCorpus = (): Buffer =>
  Buffer.concat(
    ['deflate.c', 'inflate.c', 'trees.c'].map((f) =>
      readFileSync(`${NODE_FIXTURES}deps/zlib/${f}`),
    ),
  );
