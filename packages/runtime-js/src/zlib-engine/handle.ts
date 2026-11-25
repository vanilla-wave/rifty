/**
 * Port of Node.js v24.16.0 src/node_zlib.cc — Copyright Node.js contributors, MIT
 * (generated/LICENSE). ZlibContext + CompressionStream/ZlibStream as Node's `binding.Zlib` handle
 * (`init`/`write`/`writeSync`/`params`/`reset`/`close`, the `_writeState` array, `onerror`) and
 * `binding.crc32`, over zlib.wasm (ADR-0573). The handle owns its z_stream in wasm memory; a write
 * copies its input in and its output out (C points into the JS buffers instead). Node's `CHECK`s
 * and `UNREACHABLE`s abort the process; here they throw.
 */
import { WasmMemoryError, ZS, Z_STREAM_SIZE, type ZlibEngine } from './engine';

const Z_NO_FLUSH = 0;
const Z_PARTIAL_FLUSH = 1;
const Z_SYNC_FLUSH = 2;
const Z_FULL_FLUSH = 3;
const Z_FINISH = 4;
const Z_BLOCK = 5;
const Z_OK = 0;
const Z_STREAM_END = 1;
const Z_NEED_DICT = 2;
const Z_DATA_ERROR = -3;
const Z_BUF_ERROR = -5;
const Z_DEFLATED = 8;
const FLUSHES = new Set([
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
]);
const GZIP_HEADER_ID1 = 0x1f;
const GZIP_HEADER_ID2 = 0x8b;

/** node_zlib_mode */
const NONE = 0;
const DEFLATE = 1;
const INFLATE = 2;
const GZIP = 3;
const GUNZIP = 4;
const DEFLATERAW = 5;
const INFLATERAW = 6;
const UNZIP = 7;

const ZLIB_ERROR_CODES: Record<number, string> = {
  0: 'Z_OK',
  1: 'Z_STREAM_END',
  2: 'Z_NEED_DICT',
  [-1]: 'Z_ERRNO',
  [-2]: 'Z_STREAM_ERROR',
  [-3]: 'Z_DATA_ERROR',
  [-4]: 'Z_MEM_ERROR',
  [-5]: 'Z_BUF_ERROR',
  [-6]: 'Z_VERSION_ERROR',
};

function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`zlib handle: ${what}`);
}

interface CompressionError {
  message: string;
  code: string;
  err: number;
}

/** A port allocation that failed reaches the caller as zlib's own: Node's `Z_MEM_ERROR` path. */
const MEMORY_ERROR: CompressionError = {
  message: 'insufficient memory',
  code: 'Z_MEM_ERROR',
  err: -4,
};

/**
 * A buffer whose ArrayBuffer was transferred away reads, as in Node, as length 0 and a null pointer.
 * Where Node's bounds CHECK then fails (`off + len > 0`) it aborts the process; the port reports
 * zlib's `Z_STREAM_ERROR` through the error channel instead (declared, memory model).
 */
const DETACHED_ERROR: CompressionError = {
  message: 'stream error',
  code: 'Z_STREAM_ERROR',
  err: -2,
};

/** Run `fn`; a WasmMemoryError becomes MEMORY_ERROR, anything else propagates. */
function guarded<T>(fn: () => T): T | CompressionError {
  try {
    return fn();
  } catch (e) {
    if (e instanceof WasmMemoryError) return MEMORY_ERROR;
    throw e;
  }
}
const isError = (v: unknown): v is CompressionError => v === MEMORY_ERROR || v === DETACHED_ERROR;

/** V8's Uint32Value / Int32Value: ToNumber (a BigInt or Symbol throws TypeError), then wrap. */
const u32 = (v: unknown): number => +(v as number) >>> 0;
const i32 = (v: unknown): number => +(v as number) | 0;

/** Buffer::Data/Length of an ArrayBufferView: its bytes, never its elements. */
function viewBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** viewBytes, or null when the view's ArrayBuffer was transferred away (detached). */
function liveBytes(view: ArrayBufferView): Uint8Array | null {
  try {
    return viewBytes(view);
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}

/** ZlibContext over one engine; `strm` is the z_stream's wasm address once Init ran. */
class ZlibContext {
  private engineRef: ZlibEngine | null = null;
  private strm = 0;
  private zlibInitDone = false;
  private err = 0;
  private flush = 0;
  private level = 0;
  private memLevel = 0;
  private strategy = 0;
  private windowBits = 0;
  private gzipIdBytesRead = 0;
  private dictionary: Uint8Array = new Uint8Array(0);
  /**
   * Memory model (ADR-0573 §1): Node's zlib reads and writes the caller's memory live; the port
   * copies. A write's input is snapshotted when the write is called (`write` and `writeSync`
   * alike) and kept only while zlib has not consumed it — lib/zlib.js's continuation writes (same
   * buffer, starting where zlib stopped, same end) read that snapshot, any other write copies
   * afresh. The output is copied into the caller's `out` when the work ends; between calls no
   * output copy is kept (`params` flushes through a temporary one into the last `out`).
   */
  private input: {
    ptr: number;
    buffer: ArrayBufferLike | null;
    start: number;
    end: number;
    /** byteOffset where the last write's unconsumed input begins. */
    next: number;
  } = { ptr: 0, buffer: null, start: 0, end: 0, next: -1 };
  /** The caller's `out` of the last write and how much of it zlib filled (next_out, in JS). */
  private out: { view: Uint8Array | null; cursor: number } = { view: null, cursor: 0 };
  /**
   * The dictionary's wasm copy (Node keeps its own std::vector): made before zlib is initialised,
   * kept until `close`; after a second `init()` it is made again at first use (`reset`, Z_NEED_DICT),
   * where a failed allocation is `onerror` Z_MEM_ERROR.
   */
  private dictPtr = 0;

  constructor(
    private readonly engineOf: () => ZlibEngine,
    private mode: number,
  ) {}

  init(
    level: number,
    windowBits: number,
    memLevel: number,
    strategy: number,
    dictionary: Uint8Array,
  ): void {
    if (
      !(windowBits === 0 && (this.mode === INFLATE || this.mode === GUNZIP || this.mode === UNZIP))
    )
      check(windowBits >= 8 && windowBits <= 15, 'invalid windowBits');
    check(level >= -1 && level <= 9, 'invalid compression level');
    check(memLevel >= 1 && memLevel <= 9, 'invalid memlevel');
    check([0, 1, 2, 3, 4].includes(strategy), 'invalid strategy');
    this.level = level;
    this.windowBits = windowBits;
    this.memLevel = memLevel;
    this.strategy = strategy;
    this.flush = Z_NO_FLUSH;
    this.err = Z_OK;
    if (this.mode === GZIP || this.mode === GUNZIP) this.windowBits += 16;
    if (this.mode === UNZIP) this.windowBits += 32;
    if (this.mode === DEFLATERAW || this.mode === INFLATERAW) this.windowBits *= -1;
    this.dictionary = dictionary;
    this.dropDictionaryCopy();
  }

  private dropDictionaryCopy(): void {
    if (this.dictPtr !== 0) this.engine.free(this.dictPtr);
    this.dictPtr = 0;
  }

  private dictionaryAddress(): number {
    if (this.dictPtr === 0) this.dictPtr = this.engine.copyIn(this.dictionary);
    return this.dictPtr;
  }

  private dropInput(): void {
    if (this.input.ptr === 0) return;
    this.engine.free(this.input.ptr);
    this.input = { ptr: 0, buffer: null, start: 0, end: 0, next: -1 };
    if (this.strm !== 0) {
      // zlib must never see a pointer into a freed snapshot (params' deflate(Z_BLOCK) reads it).
      this.engine.setU32(this.strm + ZS.nextIn, 0);
      this.engine.setU32(this.strm + ZS.availIn, 0);
    }
  }

  /** Load the engine now (ZlibEngineError here, before a write is in progress). */
  loadEngine(): void {
    void this.engine;
  }

  close(): void {
    if (!this.zlibInitDone) {
      this.dictionary = new Uint8Array(0);
      this.mode = NONE;
      this.release();
      return;
    }
    check(this.mode <= UNZIP, 'invalid mode');
    const x = this.engine.x;
    let status = Z_OK;
    if (this.mode === DEFLATE || this.mode === GZIP || this.mode === DEFLATERAW)
      status = x.deflateEnd(this.strm);
    else if (this.mode !== NONE) status = x.inflateEnd(this.strm);
    check(status === Z_OK || status === Z_DATA_ERROR, 'deflateEnd/inflateEnd');
    this.mode = NONE;
    this.dictionary = new Uint8Array(0);
    this.release();
  }

  /** Like Node, Init touches no zlib: the engine loads at the first write, params or reset. */
  private get engine(): ZlibEngine {
    this.engineRef ??= this.engineOf();
    return this.engineRef;
  }

  /** Port-only: the z_stream's own 56 bytes in wasm memory (C keeps it inside the object). */
  private stream(): number {
    if (this.strm === 0) {
      this.strm = this.engine.malloc(Z_STREAM_SIZE);
      this.engine.heap().fill(0, this.strm, this.strm + Z_STREAM_SIZE);
    }
    return this.strm;
  }

  private release(): void {
    if (this.strm === 0 && this.input.ptr === 0 && this.dictPtr === 0) return;
    if (this.strm !== 0) this.engine.free(this.strm);
    this.strm = 0;
    this.dropInput();
    this.dropDictionaryCopy();
    this.out = { view: null, cursor: 0 };
  }

  /**
   * Snapshot `bytes` (a view of the caller's input) for the write being called; its wasm address,
   * 0 where Node's pointer would be null (no input, an empty ArrayBuffer). The kept snapshot on a
   * continuation. May throw WasmMemoryError.
   */
  snapshot(bytes: Uint8Array | null): number {
    if (bytes === null || bytes.buffer.byteLength === 0 || bytes.byteLength === 0) {
      this.dropInput();
      return 0;
    }
    const c = this.input;
    const start = bytes.byteOffset;
    const end = start + bytes.byteLength;
    if (c.ptr !== 0 && c.buffer === bytes.buffer && start === c.next && end === c.end)
      return c.ptr + (start - c.start);
    const ptr = this.engine.copyIn(bytes);
    this.dropInput();
    this.input = { ptr, buffer: bytes.buffer, start, end, next: -1 };
    return ptr;
  }

  /** zlib's bytes in [from, next_out) of a temporary out → the caller's `out` at its cursor. */
  private copyOut(from: number): void {
    const to = this.engine.u32(this.strm + ZS.nextOut);
    const { view, cursor } = this.out;
    if (view === null || to <= from) return;
    // A view whose ArrayBuffer was transferred away reads as empty: nothing is copied (declared).
    if (view.byteLength >= cursor + (to - from))
      view.set(this.engine.heap().subarray(from, to), cursor);
    this.out.cursor += to - from;
  }

  /**
   * SetBuffers + SetFlush + DoThreadPoolWork + GetAfterWriteOffsets: `inPtr` from `snapshot`,
   * `out` through a temporary wasm buffer freed before returning. May throw WasmMemoryError.
   */
  work(
    flush: number,
    inPtr: number,
    inLen: number,
    out: { view: Uint8Array; length: number; isNull: boolean },
  ): { availIn: number; availOut: number } {
    this.stream();
    const e = this.engine;
    // `out`'s length and null-ness are the call's: a view moved away since gets no bytes (declared).
    const outPtr = out.isNull ? 0 : e.malloc(Math.max(out.length, 1));
    try {
      this.out = { view: out.isNull ? null : out.view, cursor: 0 };
      e.setU32(this.strm + ZS.nextIn, inPtr);
      e.setU32(this.strm + ZS.availIn, inLen);
      e.setU32(this.strm + ZS.nextOut, outPtr);
      e.setU32(this.strm + ZS.availOut, out.length);
      this.flush = flush;
      this.doThreadPoolWork();
      this.copyOut(outPtr);
    } finally {
      if (outPtr !== 0) e.free(outPtr);
      e.setU32(this.strm + ZS.nextOut, 0); // the next zlib call that writes gets its own buffer
    }
    const availIn = e.u32(this.strm + ZS.availIn);
    if (availIn === 0) this.dropInput();
    else if (this.input.ptr !== 0)
      this.input.next = this.input.start + (inPtr - this.input.ptr) + inLen - availIn;
    return { availIn, availOut: e.u32(this.strm + ZS.availOut) };
  }

  private doThreadPoolWork(): void {
    const firstInitCall = this.initZlib();
    if (firstInitCall && this.err !== Z_OK) return;
    const e = this.engine;
    const x = e.x;
    const s = this.strm;
    switch (this.mode) {
      case DEFLATE:
      case GZIP:
      case DEFLATERAW:
        this.err = x.deflate(s, this.flush);
        return;
      case UNZIP:
        this.sniffGzipHeader();
        break;
      case INFLATE:
      case GUNZIP:
      case INFLATERAW:
        break;
      default:
        check(false, 'unreachable mode in write');
    }
    this.err = x.inflate(s, this.flush);
    if (this.mode !== INFLATERAW && this.err === Z_NEED_DICT && this.dictionary.byteLength > 0) {
      this.err = this.setEngineDictionary('inflate');
      if (this.err === Z_OK) this.err = x.inflate(s, this.flush);
      else if (this.err === Z_DATA_ERROR) this.err = Z_NEED_DICT;
    }
    // Bytes left after a member: another member, or trailing garbage; zero padding is fine.
    while (
      e.u32(s + ZS.availIn) > 0 &&
      this.mode === GUNZIP &&
      this.err === Z_STREAM_END &&
      e.heap()[e.u32(s + ZS.nextIn)] !== 0x00
    ) {
      this.resetStream();
      this.err = x.inflate(s, this.flush);
    }
  }

  /** UNZIP: `1f 8b` → GUNZIP, anything else → INFLATE; the two bytes may span writes. */
  private sniffGzipHeader(): void {
    const e = this.engine;
    const availIn = e.u32(this.strm + ZS.availIn);
    let next = availIn > 0 ? e.u32(this.strm + ZS.nextIn) : 0;
    if (this.gzipIdBytesRead === 0) {
      if (next === 0) return;
      if (e.heap()[next] !== GZIP_HEADER_ID1) {
        this.mode = INFLATE;
        return;
      }
      this.gzipIdBytesRead = 1;
      next++;
      if (availIn === 1) return;
    } else if (this.gzipIdBytesRead !== 1) {
      check(false, 'invalid number of gzip magic number bytes read');
    }
    if (next === 0) return;
    if (e.heap()[next] === GZIP_HEADER_ID2) {
      this.gzipIdBytesRead = 2;
      this.mode = GUNZIP;
    } else {
      this.mode = INFLATE;
    }
  }

  private errorForMessage(message: string): CompressionError {
    const msg = this.strm === 0 ? null : this.engine.cstring(this.engine.u32(this.strm + ZS.msg));
    return {
      message: msg ?? message,
      code: ZLIB_ERROR_CODES[this.err] ?? 'Z_UNKNOWN_ERROR',
      err: this.err,
    };
  }

  getErrorInfo(): CompressionError | null {
    switch (this.err) {
      case Z_OK:
      case Z_BUF_ERROR:
        if (this.engine.u32(this.strm + ZS.availOut) !== 0 && this.flush === Z_FINISH)
          return this.errorForMessage('unexpected end of file');
        return null;
      case Z_STREAM_END:
        return null;
      case Z_NEED_DICT:
        return this.errorForMessage(
          this.dictionary.byteLength === 0 ? 'Missing dictionary' : 'Bad dictionary',
        );
      default:
        return this.errorForMessage('Zlib error');
    }
  }

  resetStream(): CompressionError | null {
    const firstInitCall = this.initZlib();
    if (firstInitCall && this.err !== Z_OK)
      return this.errorForMessage('Failed to init stream before reset');
    this.err = Z_OK;
    const x = this.engine.x;
    switch (this.mode) {
      case DEFLATE:
      case DEFLATERAW:
      case GZIP:
        this.err = x.deflateReset(this.strm);
        break;
      case INFLATE:
      case INFLATERAW:
      case GUNZIP:
        this.err = x.inflateReset(this.strm);
        break;
    }
    if (this.err !== Z_OK) return this.errorForMessage('Failed to reset stream');
    return this.setDictionary();
  }

  setParams(level: number, strategy: number): CompressionError | null {
    const firstInitCall = this.initZlib();
    if (firstInitCall && this.err !== Z_OK)
      return this.errorForMessage('Failed to init stream before set parameters');
    this.err = Z_OK;
    if (this.mode === DEFLATE || this.mode === DEFLATERAW) {
      // deflateParams may deflate(Z_BLOCK) into next_out: Node's points into the last `out`.
      const e = this.engine;
      const room =
        this.out.view === null ? 0 : e.malloc(Math.max(e.u32(this.strm + ZS.availOut), 1));
      try {
        e.setU32(this.strm + ZS.nextOut, room);
        this.err = e.x.deflateParams(this.strm, level, strategy);
        this.copyOut(room);
      } finally {
        if (room !== 0) e.free(room);
        e.setU32(this.strm + ZS.nextOut, 0);
      }
    }
    if (this.err !== Z_OK && this.err !== Z_BUF_ERROR)
      return this.errorForMessage('Failed to set parameters');
    return null;
  }

  private initZlib(): boolean {
    if (this.zlibInitDone) return false;
    this.stream();
    if (this.dictionary.byteLength > 0) this.dictionaryAddress(); // a WasmMemoryError here leaves zlib untouched
    const x = this.engine.x;
    switch (this.mode) {
      case DEFLATE:
      case GZIP:
      case DEFLATERAW:
        this.err = x.deflateInit2_(
          this.strm,
          this.level,
          Z_DEFLATED,
          this.windowBits,
          this.memLevel,
          this.strategy,
          this.engine.version,
          Z_STREAM_SIZE,
        );
        break;
      case INFLATE:
      case GUNZIP:
      case INFLATERAW:
      case UNZIP:
        this.err = x.inflateInit2_(this.strm, this.windowBits, this.engine.version, Z_STREAM_SIZE);
        break;
      default:
        check(false, 'unreachable mode in init');
    }
    if (this.err !== Z_OK) {
      this.dictionary = new Uint8Array(0);
      this.mode = NONE;
      return true;
    }
    this.setDictionary(); // InitZlib ignores the result: err_ stays set, the write reports it
    this.zlibInitDone = true;
    return true;
  }

  private setDictionary(): CompressionError | null {
    if (this.dictionary.byteLength === 0) return null;
    this.err = Z_OK;
    switch (this.mode) {
      case DEFLATE:
      case DEFLATERAW:
        this.err = this.setEngineDictionary('deflate');
        break;
      case INFLATERAW:
        // Other inflate modes set it when inflate() returns Z_NEED_DICT.
        this.err = this.setEngineDictionary('inflate');
        break;
    }
    if (this.err !== Z_OK) return this.errorForMessage('Failed to set dictionary');
    return null;
  }

  private setEngineDictionary(kind: 'deflate' | 'inflate'): number {
    const e = this.engine;
    const ptr = this.dictionaryAddress();
    return kind === 'deflate'
      ? e.x.deflateSetDictionary(this.strm, ptr, this.dictionary.byteLength)
      : e.x.inflateSetDictionary(this.strm, ptr, this.dictionary.byteLength);
  }
}

/** Runs the async write's completion later (Node: libuv's thread pool, then the loop). */
export type ScheduleWork = (run: () => void) => void;

export interface ZlibBinding {
  /** Node's `binding.Zlib`: `new Zlib(mode)`, then lib/zlib.js drives it. */
  Zlib: new (
    mode: number,
  ) => ZlibHandle;
  crc32(data: ArrayBufferView | string, value: number): number;
}

export interface ZlibHandle {
  onerror?: (message: string, errno: number, code: string) => void;
  init(
    windowBits: number,
    level: number,
    memLevel: number,
    strategy: number,
    writeResult: Uint32Array,
    writeCallback: () => void,
    dictionary: unknown,
  ): void;
  write(...args: WriteArgs): void;
  writeSync(...args: WriteArgs): void;
  params(level: number, strategy: number): void;
  reset(): void;
  close(): void;
}

type WriteArgs = [
  flush: number,
  input: ArrayBufferView | null,
  inOff: number,
  inLen: number,
  out: ArrayBufferView,
  outOff: number,
  outLen: number,
];

/**
 * Node's zlib binding over the engine `loadEngine()` makes (`new ZlibEngine(zlibWasmBytes())`) on the
 * first operation that needs it (a write, `params`, `reset`, `crc32`) — a load failure throws
 * `ZlibEngineError` there, every time.
 */
export function createZlibBinding(
  loadEngine: () => ZlibEngine,
  schedule: ScheduleWork,
): ZlibBinding {
  let engine: ZlibEngine | null = null;
  let failure: unknown = null;
  const getEngine = (): ZlibEngine => {
    if (failure !== null) throw failure;
    if (engine === null) {
      try {
        engine = loadEngine();
      } catch (e) {
        failure = e;
        throw e;
      }
    }
    return engine;
  };

  class Zlib implements ZlibHandle {
    onerror?: (message: string, errno: number, code: string) => void;
    private readonly mode: number;
    private ctx: ZlibContext | null = null;
    private writeResult: Uint32Array | null = null;
    private writeCallback: (() => void) | null = null;
    private initDone = false;
    private writeInProgress = false;
    private pendingClose = false;
    private closed = false;

    constructor(mode: number) {
      check(Number.isInteger(mode) && mode >= NONE && mode <= UNZIP, 'invalid mode');
      this.mode = mode;
    }

    init(
      windowBits: number,
      level: number,
      memLevel: number,
      strategy: number,
      writeResult: Uint32Array,
      writeCallback: () => void,
      dictionary: unknown,
    ): void {
      const [wb, lv, ml, st] = [u32(windowBits), i32(level), u32(memLevel), u32(strategy)];
      check(writeResult instanceof Uint32Array && writeResult.length >= 2, 'writeResult');
      check(typeof writeCallback === 'function', 'writeCallback');
      const dict = ArrayBuffer.isView(dictionary)
        ? viewBytes(dictionary).slice()
        : new Uint8Array(0);
      // Node writes the result at the start of the array's ArrayBuffer (`ab->Data()`).
      this.writeResult = new Uint32Array(writeResult.buffer, 0, 2);
      this.writeCallback = writeCallback;
      this.initDone = true;
      // A second init() re-reads the options into the same context: the zlib stream continues.
      this.ctx ??= new ZlibContext(getEngine, this.mode);
      this.ctx.init(lv, wb, ml, st, dict);
    }

    close(): void {
      if (this.writeInProgress) {
        this.pendingClose = true;
        return;
      }
      this.pendingClose = false;
      this.closed = true;
      check(this.initDone, 'close before init');
      this.context().close();
    }

    write(...args: WriteArgs): void {
      this.startWrite(true, args);
    }

    writeSync(...args: WriteArgs): void {
      this.startWrite(false, args);
    }

    params(level: number, strategy: number): void {
      const [lv, st] = [i32(level), i32(strategy)];
      const err = guarded(() => this.context().setParams(lv, st));
      if (err) this.emitError(err);
    }

    reset(): void {
      if (this.writeInProgress)
        throw new Error('Cannot reset zlib stream while a write is in progress');
      const err = guarded(() => this.context().resetStream());
      if (err) this.emitError(err);
    }

    private context(): ZlibContext {
      check(this.ctx !== null, 'handle used before init');
      return this.ctx;
    }

    private startWrite(async: boolean, args: WriteArgs): void {
      check(args.length === 7, 'write(flush, in, in_off, in_len, out, out_off, out_len)');
      const [flushArg, input, inOff, inLen, out, outOff, outLen] = args;
      check(flushArg !== undefined, 'must provide flush value');
      const flush = u32(flushArg);
      check(FLUSHES.has(flush), 'Invalid flush value');
      let detached = false;
      let inView: Uint8Array | null = null;
      if (input !== null) {
        check(ArrayBuffer.isView(input), 'input is not a buffer');
        const off = u32(inOff);
        const len = u32(inLen);
        const bytes = liveBytes(input);
        if (bytes === null)
          detached ||= off + len > 0; // else: Node's null pointer, length 0
        else {
          check(off + len <= bytes.byteLength, 'input out of bounds');
          inView = bytes.subarray(off, off + len);
        }
      }
      check(ArrayBuffer.isView(out), 'output is not a buffer');
      const oOff = u32(outOff);
      const oLen = u32(outLen);
      const outBytes = liveBytes(out);
      let outView: Uint8Array = new Uint8Array(0); // detached, length 0: Node's null out
      if (outBytes === null) detached ||= oOff + oLen > 0;
      else {
        check(oOff + oLen <= outBytes.byteLength, 'output out of bounds');
        outView = outBytes.subarray(oOff, oOff + oLen);
      }

      check(this.initDone, 'write before init');
      check(!this.closed, 'already finalized');
      check(!this.writeInProgress, 'write in progress');
      check(!this.pendingClose, 'pending close');
      const ctx = this.context();
      ctx.loadEngine();
      // Taken now, for both forms (memory model, ZlibContext): the input and `out`'s geometry.
      const inPtr = detached ? DETACHED_ERROR : guarded(() => ctx.snapshot(inView));
      const inBytes = inView === null ? 0 : inView.byteLength;
      const outAt = {
        view: outView,
        length: outView.byteLength,
        isNull: outView.buffer.byteLength === 0,
      };
      this.writeInProgress = true;
      const work = () =>
        isError(inPtr) ? inPtr : guarded(() => ctx.work(flush, inPtr, inBytes, outAt));
      /**
       * An internal failure (a broken check, a wasm trap — where Node's process would abort) is a
       * loud exception, never `onerror`: the write ends and a pending close runs; the original
       * exception still propagates, joined by the close's own if that throws too.
       */
      const settle = () => {
        let ended = false;
        try {
          const after = work();
          ended = true;
          return after;
        } finally {
          if (!ended) {
            this.writeInProgress = false;
            if (this.pendingClose) this.closeAfterFailure();
          }
        }
      };
      if (!async) {
        const after = settle();
        if (isError(after)) this.emitError(after);
        else if (this.checkError()) {
          this.updateWriteResult(after);
          this.writeInProgress = false;
        }
        return;
      }
      schedule(() => {
        const after = settle();
        this.writeInProgress = false;
        if (isError(after)) return this.emitError(after);
        if (!this.checkError()) return;
        this.updateWriteResult(after);
        try {
          (this.writeCallback as () => void).call(this);
        } finally {
          if (this.pendingClose) this.close();
        }
      });
    }

    /** Runs inside a `finally` that rethrows the write's exception: a close failure is not dropped. */
    private closeAfterFailure(): void {
      try {
        this.close();
      } catch (e) {
        queueMicrotask(() => {
          throw e;
        });
      }
    }

    private updateWriteResult(after: { availIn: number; availOut: number }): void {
      const r = this.writeResult as Uint32Array;
      r[1] = after.availIn;
      r[0] = after.availOut;
    }

    private checkError(): boolean {
      const err = this.context().getErrorInfo();
      if (!err) return true;
      this.emitError(err);
      return false;
    }

    /** MakeCallback(onerror): Node runs the rest even when onerror throws. */
    private emitError(err: CompressionError): void {
      try {
        this.onerror?.call(this, err.message, err.err, err.code);
      } finally {
        this.writeInProgress = false; // no hope of rescue
        if (this.pendingClose) this.close();
      }
    }
  }

  return {
    Zlib,
    crc32(data, value) {
      check(ArrayBuffer.isView(data) || typeof data === 'string', 'crc32 data');
      check(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'crc32 value');
      // Utf8Value: lone surrogates → U+FFFD, as TextEncoder.
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : viewBytes(data);
      return getEngine().crc32(bytes, value);
    },
  };
}
