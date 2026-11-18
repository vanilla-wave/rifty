/**
 * `node:zlib` — web-compression-backed async subset (ADR-0159).
 *
 * Real `gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw` over the
 * host `CompressionStream`/`DecompressionStream` (`'gzip'` / `'deflate'` /
 * `'deflate-raw'` — RFC-1952/1950/1951, byte-compatible with Node's zlib both
 * directions, conformance-pinned). The web API is async-only and exposes no
 * level/dictionary/windowBits control, so:
 *
 * - `*Sync`, brotli, zstd, `crc32`, remaining Transform streams, Transform
 *   flush-opcode options, and `unzip` stay loud `NotImplementedError` ceilings:
 *   not implemented yet, engine choice tracked in backlog
 *   runtime-js/zlib-web-compression-subset. Each export's reason names its
 *   working async alternative, or states there is none.
 * - Size/perf options (`level`/`memLevel`/`strategy`/…) are accepted no-ops
 *   (output stays valid + round-trips). `windowBits`, `dictionary`, and a truthy
 *   `info` throw: we can't set the encoder window/dict/flush mode over
 *   `CompressionStream`, so silently ignoring `windowBits` would emit a
 *   max-window (window-15) zlib stream that a strict small-window consumer rejects
 *   (`Z_DATA_ERROR`), `finishFlush` can change truncated decompression outcomes,
 *   and a truthy `info` would fake the `{buffer,engine}` return shape.
 *   `info:false` (the default) is a no-op, matching Node.
 *
 * `constants`/`codes` are the real Node table (`./zlib-constants.ts`); Node also
 * mirrors every non-`BROTLI_` constant onto the module top level (legacy shape).
 */
import { NotImplementedError, Transform } from '@riftydev/io';
import { Buffer } from './buffer.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';
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

// Export ceilings carry a required reason: the working async alternative, or none.
const notImpl =
  (feature: string, reason: string) =>
  (..._args: unknown[]): never => {
    throw new NotImplementedError(feature, reason);
  };

function unsupportedClass(feature: string, reason: string) {
  return class {
    constructor(..._args: unknown[]) {
      throw new NotImplementedError(feature, reason);
    }
  };
}

type OneShot = 'gzip' | 'gunzip' | 'deflate' | 'inflate' | 'deflateRaw' | 'inflateRaw';
const callAsync = (fn: OneShot): string =>
  `zlib.${fn}(buf, cb) or await util.promisify(zlib.${fn})(buf)`;
const BY_HEADER =
  'pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify';
const syncReason = (fn: OneShot): string =>
  `sync zlib not implemented yet; async zlib.${fn} works: ${callAsync(fn)}`;
const streamReason = (fn: OneShot): string =>
  `this stream not implemented yet; buffer the input, then call async zlib.${fn}: ${callAsync(fn)}`;
const UNZIP_STREAM_REASON = `this stream not implemented yet; buffer the input, then ${BY_HEADER}`;
const noAlternative = (codec: 'brotli' | 'zstd' | 'crc32'): string =>
  `${codec} not implemented yet; node:zlib has no working alternative`;
const BROTLI = noAlternative('brotli');
const ZSTD = noAlternative('zstd');

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
//   - `flush` / `finishFlush`: callers request zlib flush opcodes and chunking /
//     decompression-finalization semantics that `CompressionStream` cannot expose.
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
      (result) => runNodeCallback(cb, null, result),
      (error: unknown) =>
        runNodeCallback(cb, error instanceof Error ? error : new Error(String(error))),
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
  /** The CompressionStream writer, kept so destroy() can abort it (else
   *  drainCompressed's reader.read() awaits forever — a per-realm leak). */
  private compressionWriter: WritableStreamDefaultWriter<BufferSource> | null = null;

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
    this.compressionWriter = writer;
    drainDone = this.drainCompressed(stream.readable as ReadableStream<Uint8Array>);
  }

  /** Tear down the underlying CompressionStream on destroy: abort the writer so
   *  drainCompressed's reader.read() rejects and releases its lock instead of
   *  awaiting forever (the writer/reader + CompressionStream would otherwise
   *  leak for the realm lifetime — e.g. an HTTP client aborting mid-response). */
  override destroy(err?: Error): this {
    void this.compressionWriter?.abort().catch(() => {});
    this.compressionWriter = null;
    return super.destroy(err);
  }

  get bytesWritten(): never {
    throw new NotImplementedError('zlib.Gzip.bytesWritten');
  }

  flush(..._args: unknown[]): never {
    throw new NotImplementedError('zlib.Gzip.flush');
  }

  params(..._args: unknown[]): never {
    throw new NotImplementedError('zlib.Gzip.params');
  }

  reset(..._args: unknown[]): never {
    throw new NotImplementedError('zlib.Gzip.reset');
  }

  close(..._args: unknown[]): never {
    throw new NotImplementedError('zlib.Gzip.close');
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
    } catch {
      // The compressed readable only rejects when the writable side is aborted
      // (destroy() teardown). Nothing left to drain; let destroy()/flush()
      // settle. A normal close() ends with done:true and never lands here.
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

  // Sync ceilings — `CompressionStream` is async-only; no sync engine yet (backlog).
  gzipSync: notImpl('zlib.gzipSync', syncReason('gzip')),
  gunzipSync: notImpl('zlib.gunzipSync', syncReason('gunzip')),
  deflateSync: notImpl('zlib.deflateSync', syncReason('deflate')),
  inflateSync: notImpl('zlib.inflateSync', syncReason('inflate')),
  deflateRawSync: notImpl('zlib.deflateRawSync', syncReason('deflateRaw')),
  inflateRawSync: notImpl('zlib.inflateRawSync', syncReason('inflateRaw')),

  // Auto-detect (gzip vs zlib) — header-sniff deferred to its own parity surface.
  unzip: notImpl('zlib.unzip', `gzip/zlib auto-detect not implemented yet; ${BY_HEADER}`),
  unzipSync: notImpl('zlib.unzipSync', `sync zlib not implemented yet; ${BY_HEADER}`),

  // Brotli — no Web API for brotli in the realm.
  brotliCompress: notImpl('zlib.brotliCompress', BROTLI),
  brotliCompressSync: notImpl('zlib.brotliCompressSync', BROTLI),
  brotliDecompress: notImpl('zlib.brotliDecompress', BROTLI),
  brotliDecompressSync: notImpl('zlib.brotliDecompressSync', BROTLI),

  // Zstd — no Web API for zstd in the realm.
  zstdCompress: notImpl('zlib.zstdCompress', ZSTD),
  zstdCompressSync: notImpl('zlib.zstdCompressSync', ZSTD),
  zstdDecompress: notImpl('zlib.zstdDecompress', ZSTD),
  zstdDecompressSync: notImpl('zlib.zstdDecompressSync', ZSTD),

  // CRC-32 — deferred (not part of the compression subset).
  crc32: notImpl('zlib.crc32', noAlternative('crc32')),

  // Gzip Transform stream — enough for compression middleware such as Vite
  // preview's sirv path. Flush-opcode variants and the remaining factories stay
  // loud ceilings until their own parity surface lands.
  createGzip,
  createGunzip: notImpl('zlib.createGunzip', streamReason('gunzip')),
  createDeflate: notImpl('zlib.createDeflate', streamReason('deflate')),
  createInflate: notImpl('zlib.createInflate', streamReason('inflate')),
  createDeflateRaw: notImpl('zlib.createDeflateRaw', streamReason('deflateRaw')),
  createInflateRaw: notImpl('zlib.createInflateRaw', streamReason('inflateRaw')),
  createUnzip: notImpl('zlib.createUnzip', UNZIP_STREAM_REASON),
  createBrotliCompress: notImpl('zlib.createBrotliCompress', BROTLI),
  createBrotliDecompress: notImpl('zlib.createBrotliDecompress', BROTLI),
  createZstdCompress: notImpl('zlib.createZstdCompress', ZSTD),
  createZstdDecompress: notImpl('zlib.createZstdDecompress', ZSTD),

  // Stream classes — throw on construct (same ceiling as the create* factories).
  Gzip,
  Gunzip: unsupportedClass('zlib.Gunzip', streamReason('gunzip')),
  Deflate: unsupportedClass('zlib.Deflate', streamReason('deflate')),
  Inflate: unsupportedClass('zlib.Inflate', streamReason('inflate')),
  DeflateRaw: unsupportedClass('zlib.DeflateRaw', streamReason('deflateRaw')),
  InflateRaw: unsupportedClass('zlib.InflateRaw', streamReason('inflateRaw')),
  Unzip: unsupportedClass('zlib.Unzip', UNZIP_STREAM_REASON),
  BrotliCompress: unsupportedClass('zlib.BrotliCompress', BROTLI),
  BrotliDecompress: unsupportedClass('zlib.BrotliDecompress', BROTLI),
  ZstdCompress: unsupportedClass('zlib.ZstdCompress', ZSTD),
  ZstdDecompress: unsupportedClass('zlib.ZstdDecompress', ZSTD),

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
