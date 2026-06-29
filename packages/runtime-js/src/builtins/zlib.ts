/**
 * `node:zlib` — web-compression-backed async subset (ADR-0159).
 *
 * Real `gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw` over the
 * host `CompressionStream`/`DecompressionStream` (`'gzip'` / `'deflate'` /
 * `'deflate-raw'` — RFC-1952/1950/1951, byte-compatible with Node's zlib both
 * directions, conformance-pinned). The web API is async-only and exposes no
 * level/dictionary/windowBits control, so:
 *
 * - `*Sync`, brotli, zstd, `crc32`, remaining Transform streams, flush-opcode
 *   options, and `unzip` stay loud `NotImplementedError` ceilings (no honest
 *   browser path — see backlog runtime-js/zlib-web-compression-subset).
 * - Size/perf options (`level`/`memLevel`/`strategy`/…) are accepted no-ops
 *   (output stays valid + round-trips). `windowBits`, `dictionary`, and a truthy
 *   `info` throw: we can't set the encoder window/dict over `CompressionStream`,
 *   so silently ignoring `windowBits` would emit a max-window (window-15) zlib
 *   stream that a strict small-window consumer rejects (`Z_DATA_ERROR`), and a
 *   truthy `info` would fake the `{buffer,engine}` return shape. `info:false`
 *   (the default) is a no-op, matching Node.
 *
 * `constants`/`codes` are the real Node table (`./zlib-constants.ts`); Node also
 * mirrors every non-`BROTLI_` constant onto the module top level (legacy shape).
 */
import { NotImplementedError, Transform } from '@riftydev/io';
import { Buffer } from './buffer.ts';
import { ZLIB_CODES, ZLIB_CONSTANTS } from './zlib-constants.ts';

type ZlibInput = string | ArrayBuffer | ArrayBufferView;
type ZlibCallback = (error: Error | null, result?: Buffer) => void;

interface ZlibOptions {
  level?: number;
  memLevel?: number;
  strategy?: number;
  chunkSize?: number;
  flush?: number;
  finishFlush?: number;
  windowBits?: number;
  dictionary?: ArrayBufferView;
  info?: boolean;
  maxOutputLength?: number;
}

type AsyncZlibFn = (
  data: ZlibInput,
  optionsOrCallback: ZlibOptions | ZlibCallback,
  callback?: ZlibCallback,
) => void;

const notImpl =
  (feature: string) =>
  (..._args: unknown[]): never => {
    throw new NotImplementedError(feature);
  };

function unsupportedClass(feature: string) {
  return class {
    constructor(..._args: unknown[]) {
      throw new NotImplementedError(feature);
    }
  };
}

/** Web compression formats `CompressionStream`/`DecompressionStream` accept. */
type WebFormat = 'gzip' | 'deflate' | 'deflate-raw';

// Options we genuinely cannot honor over `CompressionStream` — silently ignoring
// would corrupt interop / change the return shape, so they throw (not faked):
//   - `windowBits`: sets the encoder window, encoded in the RFC-1950 zlib header
//     (CINFO). `CompressionStream` always emits a max-window (window-15) stream;
//     ignoring a smaller requested `windowBits` would emit window-15 bytes that a
//     strict real-Node consumer pinning that smaller `windowBits` rejects with
//     `Z_DATA_ERROR` — a silent wire-lie. (gzip/raw carry no window field, but we
//     reject uniformly: the producer can't know which framing the caller decodes
//     with, and a loud throw beats a per-format silent-lie gamble.)
//   - `dictionary`: a preset dict changes the compressed wire bytes and needs the
//     same dict to inflate; the stream API takes no dictionary.
//   - `flush` / `finishFlush`: callers request zlib flush opcodes and chunking
//     semantics that `CompressionStream` cannot expose.
//   - `info` (truthy): Node returns `{ buffer, engine }` for ANY truthy `info`;
//     there is no engine handle to return. `info: false` (the default) is a no-op.
function assertSupportedOptions(feature: string, options: ZlibOptions | undefined): void {
  if (!options) return;
  if (options.flush !== undefined) {
    throw new NotImplementedError(`${feature} option: flush`);
  }
  if (options.finishFlush !== undefined) {
    throw new NotImplementedError(`${feature} option: finishFlush`);
  }
  if (options.windowBits !== undefined) {
    throw new NotImplementedError(`${feature} option: windowBits`);
  }
  if (options.dictionary !== undefined) {
    throw new NotImplementedError(`${feature} option: dictionary`);
  }
  if (options.info) throw new NotImplementedError(`${feature} option: info`);
}

function toBytes(input: ZlibInput): Uint8Array<ArrayBuffer> {
  return toBytesWithEncoding(input, 'utf8');
}

function toBytesWithEncoding(input: unknown, encoding: string): Uint8Array<ArrayBuffer> {
  let view: Uint8Array;
  if (typeof input === 'string') view = Buffer.from(input, encoding as BufferEncoding);
  else if (input instanceof Uint8Array) view = input;
  else if (input instanceof ArrayBuffer) view = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) {
    view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new TypeError(
      'zlib: input must be a string, Buffer, TypedArray, DataView, or ArrayBuffer',
    );
  }
  // Copy into a fresh plain-`ArrayBuffer`-backed view: the stream writer needs a
  // non-shared `BufferSource`, and the copy guarantees that even if `input` was
  // SharedArrayBuffer-backed (a Buffer in a kernel Worker).
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseArgs(
  feature: string,
  optionsOrCallback: ZlibOptions | ZlibCallback,
  callback: ZlibCallback | undefined,
): { options: ZlibOptions | undefined; cb: ZlibCallback } {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
  const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
  if (typeof cb !== 'function') throw new TypeError(`${feature}: callback is not a function`);
  return { options, cb };
}

/** Node's `ERR_BUFFER_TOO_LARGE` shape for an over-`maxOutputLength` result. */
function bufferTooLarge(max: number): RangeError {
  const err = new RangeError(`Cannot create a Buffer larger than ${max} bytes`);
  (err as RangeError & { code?: string }).code = 'ERR_BUFFER_TOO_LARGE';
  return err;
}

/**
 * Drive one chunk through a `CompressionStream`/`DecompressionStream` and read
 * all output. Reads incrementally so a `maxOutputLength` cap aborts EARLY
 * (cancelling the stream) the moment the running total exceeds it — matching
 * Node's `ERR_BUFFER_TOO_LARGE` both observably and as a decompression-bomb
 * guard, not a post-hoc length check. Writer-side errors (corrupt input errors
 * the whole transform) surface through the reader; the swallowed `writeDone`
 * only prevents a duplicate unhandled rejection.
 */
async function runStream(
  stream: CompressionStream | DecompressionStream,
  bytes: Uint8Array<ArrayBuffer>,
  maxOutputLength: number | undefined,
): Promise<Buffer> {
  const writer = stream.writable.getWriter();
  const writeDone = (async () => {
    await writer.write(bytes);
    await writer.close();
  })().catch(() => {});
  const reader = (stream.readable as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (maxOutputLength !== undefined && total > maxOutputLength) {
        await reader.cancel();
        throw bufferTooLarge(maxOutputLength);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await writeDone;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(out);
}

function makeAsync(
  feature: string,
  format: WebFormat,
  mode: 'compress' | 'decompress',
): AsyncZlibFn {
  return (data, optionsOrCallback, callback) => {
    const { options, cb } = parseArgs(feature, optionsOrCallback, callback);
    assertSupportedOptions(feature, options);
    if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') {
      throw new NotImplementedError(
        feature,
        'CompressionStream/DecompressionStream unavailable in this realm',
      );
    }
    const bytes = toBytes(data); // sync TypeError on a bad input type (Node parity)
    const stream =
      mode === 'compress' ? new CompressionStream(format) : new DecompressionStream(format);
    runStream(stream, bytes, options?.maxOutputLength).then(
      (result) => cb(null, result),
      (error: unknown) => cb(error instanceof Error ? error : new Error(String(error))),
    );
  };
}

const gzip = makeAsync('zlib.gzip', 'gzip', 'compress');
const gunzip = makeAsync('zlib.gunzip', 'gzip', 'decompress');
const deflate = makeAsync('zlib.deflate', 'deflate', 'compress');
const inflate = makeAsync('zlib.inflate', 'deflate', 'decompress');
const deflateRaw = makeAsync('zlib.deflateRaw', 'deflate-raw', 'compress');
const inflateRaw = makeAsync('zlib.inflateRaw', 'deflate-raw', 'decompress');

class Gzip extends Transform {
  constructor(options?: ZlibOptions) {
    assertSupportedOptions('zlib.createGzip', options);
    if (typeof CompressionStream !== 'function') {
      throw new NotImplementedError(
        'zlib.createGzip',
        'CompressionStream unavailable in this realm',
      );
    }
    let writer: WritableStreamDefaultWriter<BufferSource> | null = null;
    let drainDone: Promise<void> | null = null;
    const pendingWrites = new Set<Promise<void>>();
    super({
      transform(chunk, encoding, cb): void {
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = toBytesWithEncoding(chunk, encoding);
        } catch (err) {
          cb(toError(err));
          return;
        }
        if (writer === null) {
          cb(new Error('zlib.createGzip writer not initialized'));
          return;
        }
        const writeDone = writer.write(bytes);
        pendingWrites.add(writeDone);
        void writeDone.then(
          () => pendingWrites.delete(writeDone),
          () => pendingWrites.delete(writeDone),
        );
        void writeDone.catch(() => {});
        cb();
      },
      flush(cb): void {
        const currentWriter = writer;
        if (currentWriter === null) {
          cb(new Error('zlib.createGzip writer not initialized'));
          return;
        }
        void Promise.all([...pendingWrites])
          .then(() => currentWriter.close())
          .then(() => drainDone)
          .then(
            () => cb(),
            (err: unknown) => cb(toError(err)),
          );
      },
    });
    const stream = new CompressionStream('gzip');
    writer = stream.writable.getWriter();
    drainDone = this.drainCompressed(stream.readable as ReadableStream<Uint8Array>);
  }

  private async drainCompressed(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.byteLength > 0) {
          this.push(Buffer.from(value));
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function createGzip(options?: ZlibOptions): Gzip {
  return new Gzip(options);
}

// Node mirrors every non-`BROTLI_` constant onto the module top level (legacy,
// deprecated) as a NON-enumerable, read-only data property — defined below so
// `Object.keys(zlib)` / `for…in` match Node, which excludes these aliases.
type LegacyTopLevelConstants = {
  readonly [K in keyof typeof ZLIB_CONSTANTS as K extends `BROTLI_${string}` ? never : K]: number;
};

const zlibModule = {
  // Implemented — web-compression-backed async one-shot.
  gzip,
  gunzip,
  deflate,
  inflate,
  deflateRaw,
  inflateRaw,

  // Sync ceilings — `CompressionStream` is async-only; a sync facade would lie.
  gzipSync: notImpl('zlib.gzipSync'),
  gunzipSync: notImpl('zlib.gunzipSync'),
  deflateSync: notImpl('zlib.deflateSync'),
  inflateSync: notImpl('zlib.inflateSync'),
  deflateRawSync: notImpl('zlib.deflateRawSync'),
  inflateRawSync: notImpl('zlib.inflateRawSync'),

  // Auto-detect (gzip vs zlib) — header-sniff deferred to its own parity surface.
  unzip: notImpl('zlib.unzip'),
  unzipSync: notImpl('zlib.unzipSync'),

  // Brotli — no Web API for brotli in the realm.
  brotliCompress: notImpl('zlib.brotliCompress'),
  brotliCompressSync: notImpl('zlib.brotliCompressSync'),
  brotliDecompress: notImpl('zlib.brotliDecompress'),
  brotliDecompressSync: notImpl('zlib.brotliDecompressSync'),

  // Zstd — no Web API for zstd in the realm.
  zstdCompress: notImpl('zlib.zstdCompress'),
  zstdCompressSync: notImpl('zlib.zstdCompressSync'),
  zstdDecompress: notImpl('zlib.zstdDecompress'),
  zstdDecompressSync: notImpl('zlib.zstdDecompressSync'),

  // CRC-32 — deferred (not part of the compression subset).
  crc32: notImpl('zlib.crc32'),

  // Gzip Transform stream — enough for compression middleware such as Vite
  // preview's sirv path. Flush-opcode variants and the remaining factories stay
  // loud ceilings until their own parity surface lands.
  createGzip,
  createGunzip: notImpl('zlib.createGunzip'),
  createDeflate: notImpl('zlib.createDeflate'),
  createInflate: notImpl('zlib.createInflate'),
  createDeflateRaw: notImpl('zlib.createDeflateRaw'),
  createInflateRaw: notImpl('zlib.createInflateRaw'),
  createUnzip: notImpl('zlib.createUnzip'),
  createBrotliCompress: notImpl('zlib.createBrotliCompress'),
  createBrotliDecompress: notImpl('zlib.createBrotliDecompress'),
  createZstdCompress: notImpl('zlib.createZstdCompress'),
  createZstdDecompress: notImpl('zlib.createZstdDecompress'),

  // Stream classes — throw on construct (same ceiling as the create* factories).
  Gzip,
  Gunzip: unsupportedClass('zlib.Gunzip'),
  Deflate: unsupportedClass('zlib.Deflate'),
  Inflate: unsupportedClass('zlib.Inflate'),
  DeflateRaw: unsupportedClass('zlib.DeflateRaw'),
  InflateRaw: unsupportedClass('zlib.InflateRaw'),
  Unzip: unsupportedClass('zlib.Unzip'),
  BrotliCompress: unsupportedClass('zlib.BrotliCompress'),
  BrotliDecompress: unsupportedClass('zlib.BrotliDecompress'),
  ZstdCompress: unsupportedClass('zlib.ZstdCompress'),
  ZstdDecompress: unsupportedClass('zlib.ZstdDecompress'),

  // Pure data — real Node values.
  constants: ZLIB_CONSTANTS,
  codes: ZLIB_CODES,
};

for (const [key, value] of Object.entries(ZLIB_CONSTANTS)) {
  if (key.startsWith('BROTLI_')) continue;
  Object.defineProperty(zlibModule, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

export default zlibModule as typeof zlibModule & LegacyTopLevelConstants;
