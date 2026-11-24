// Node v24.16.0's zlib handle semantics over an engine: a port of node_zlib.cc ZlibContext
// (Init/InitZlib/SetDictionary/DoThreadPoolWork/GetErrorInfo/ResetStream/SetParams) and
// lib/zlib.js processChunkSync. Engine-independent: any difference vs Node is the engine's.
// No node:zlib import: the binding swap preloads this before a test may patch buffer.kMaxLength.
const C = {
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_DATA_ERROR: -3,
  Z_BUF_ERROR: -5,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_DEFAULT_COMPRESSION: -1,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_DEFAULT_STRATEGY: 0,
  Z_DEFAULT_CHUNK: 16384,
};
const MODES = {
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
};
const ERRNO_CODE = {
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

export class ZlibError extends Error {
  constructor(message, errno) {
    super(message);
    this.errno = errno;
    this.code = ERRNO_CODE[errno];
  }
}

export class Context {
  constructor(engine, mode, opts = {}) {
    this.engine = engine;
    this.mode = MODES[mode];
    const isDeflate = [1, 3, 5].includes(this.mode);
    this.s = engine.stream(isDeflate ? 'deflate' : 'inflate');
    this.isDeflate = isDeflate;
    let wb = opts.windowBits ?? C.Z_DEFAULT_WINDOWBITS;
    if (this.mode === MODES.GZIP || this.mode === MODES.GUNZIP) wb += 16;
    if (this.mode === MODES.UNZIP) wb += 32;
    if (this.mode === MODES.DEFLATERAW || this.mode === MODES.INFLATERAW) wb *= -1;
    this.windowBits = wb;
    this.level = opts.level ?? C.Z_DEFAULT_COMPRESSION;
    this.memLevel = opts.memLevel ?? C.Z_DEFAULT_MEMLEVEL;
    this.strategy = opts.strategy ?? C.Z_DEFAULT_STRATEGY;
    const d = opts.dictionary; // any ArrayBufferView: its bytes, as Buffer::Data
    this.dictionary = d ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : null;
    this.chunkSize = opts.chunkSize ?? C.Z_DEFAULT_CHUNK;
    this.room = this.chunkSize; // lib/zlib.js _outOffset: the out buffer persists across chunks
    this.finishFlush = opts.finishFlush ?? C.Z_FINISH;
    this.maxOutputLength = opts.maxOutputLength ?? 2 ** 32;
    this.initDone = false;
    this.err = 0;
    this.msg = null;
    this.gzipIdBytesRead = 0;
    this.bytesWritten = 0;
  }
  initZlib() {
    if (this.initDone) return false;
    this.err = this.s.init({
      level: this.level,
      windowBits: this.windowBits,
      memLevel: this.memLevel,
      strategy: this.strategy,
    });
    if (this.err !== 0) {
      this.mode = 0;
      return true;
    }
    this.setDictionary(); // InitZlib ignores its error: err_ stays set and the write reports it
    this.initDone = true;
    return true;
  }
  setDictionary() {
    if (
      !this.dictionary ||
      ![MODES.DEFLATE, MODES.DEFLATERAW, MODES.INFLATERAW].includes(this.mode)
    )
      return null;
    this.err = this.s.setDictionary(this.dictionary);
    return this.err !== 0 ? this.errorFor('Failed to set dictionary') : null;
  }
  run(flush, input, outLen) {
    const r = this.s.write(flush, input, outLen);
    this.err = r.err;
    this.msg = r.msg;
    return r;
  }
  /** One handle.writeSync: returns { availIn, availOut, out } or throws Node's error. */
  write(flush, input, outLen) {
    if (this.initZlib() && this.err !== 0) throw this.errorInfo(0);
    this.flush = flush;
    let r;
    if (this.isDeflate) {
      r = this.run(flush, input, outLen);
    } else {
      if (this.mode === MODES.UNZIP && input.length > 0) {
        let i = 0;
        if (this.gzipIdBytesRead === 0) {
          if (input[0] === 0x1f) {
            this.gzipIdBytesRead = 1;
            i = 1;
          } else this.mode = MODES.INFLATE;
        }
        if (this.mode === MODES.UNZIP && this.gzipIdBytesRead === 1 && i < input.length) {
          if (input[i] === 0x8b) {
            this.gzipIdBytesRead = 2;
            this.mode = MODES.GUNZIP;
          } else this.mode = MODES.INFLATE;
        }
      }
      r = this.run(flush, input, outLen);
      if (this.mode !== MODES.INFLATERAW && this.err === C.Z_NEED_DICT && this.dictionary) {
        this.err = this.s.setDictionary(this.dictionary);
        if (this.err === 0) r = this.runRest(r, flush, input, outLen);
        else if (this.err === C.Z_DATA_ERROR) this.err = C.Z_NEED_DICT;
      }
      while (
        r.availIn > 0 &&
        this.mode === MODES.GUNZIP &&
        this.err === C.Z_STREAM_END &&
        input[input.length - r.availIn] !== 0x00
      ) {
        this.s.reset();
        r = this.runRest(r, flush, input, outLen);
      }
    }
    const e = this.errorInfo(r.availOut);
    if (e) throw e;
    return r;
  }
  // Continue on the same in/out buffers (C keeps next_in/next_out; the adapters copy, so we splice).
  runRest(prev, flush, input, _outLen) {
    const consumed = input.length - prev.availIn;
    const r = this.run(flush, input.subarray(consumed), prev.availOut);
    const out = new Uint8Array(prev.out.length + r.out.length);
    out.set(prev.out);
    out.set(r.out, prev.out.length);
    return { ...r, out };
  }
  errorFor(message) {
    return new ZlibError(this.msg ?? message, this.err);
  }
  errorInfo(availOut) {
    switch (this.err) {
      case C.Z_OK:
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: GetErrorInfo's own fallthrough
      case C.Z_BUF_ERROR:
        if (availOut !== 0 && this.flush === C.Z_FINISH)
          return this.errorFor('unexpected end of file');
      // fallthrough
      case C.Z_STREAM_END:
        return null;
      case C.Z_NEED_DICT:
        return this.errorFor(this.dictionary ? 'Bad dictionary' : 'Missing dictionary');
      default:
        return this.errorFor('Zlib error');
    }
  }
  params(level, strategy) {
    if (this.initZlib() && this.err !== 0)
      throw this.errorFor('Failed to init stream before set parameters');
    if (this.mode !== MODES.DEFLATE && this.mode !== MODES.DEFLATERAW) return;
    this.err = this.s.params(level, strategy);
    if (this.err !== 0 && this.err !== C.Z_BUF_ERROR)
      throw this.errorFor('Failed to set parameters');
  }
  reset() {
    const first = this.initZlib();
    if (first && this.err !== 0) throw this.errorFor('Failed to init stream before reset');
    this.err = this.mode >= MODES.DEFLATE && this.mode <= MODES.INFLATERAW ? this.s.reset() : 0; // UNZIP (not yet sniffed) / NONE: no-op, as ResetStream
    if (this.err !== 0) throw this.errorFor('Failed to reset stream');
    const e = this.setDictionary();
    if (e) throw e;
  }
  close() {
    if (this.initDone) this.s.end();
    this.initDone = false;
    this.mode = 0;
  }
  /** lib/zlib.js processChunkSync with Node's chunkSize output buffers. */
  processChunkSync(chunk, flushFlag) {
    let availInBefore = chunk.length;
    let inOff = 0;
    const out = [];
    let nread = 0;
    let read = 0;
    for (;;) {
      const r = this.write(flushFlag, chunk.subarray(inOff, inOff + availInBefore), this.room);
      read += availInBefore - r.availIn;
      if (r.out.length) {
        out.push(r.out);
        nread += r.out.length;
        if (nread > this.maxOutputLength)
          throw Object.assign(
            new RangeError(`Cannot create a Buffer larger than ${this.maxOutputLength} bytes`),
            { code: 'ERR_BUFFER_TOO_LARGE' },
          );
      }
      this.room = r.availOut === 0 ? this.chunkSize : r.availOut;
      if (r.availOut === 0) {
        inOff += availInBefore - r.availIn;
        availInBefore = r.availIn;
      } else break;
    }
    this.bytesWritten += read;
    return Buffer.concat(out);
  }
}

/** zlibBufferSync: one chunk with the finish flush. */
export function oneShotSync(engine, mode, input, opts) {
  const ctx = new Context(engine, mode, opts);
  try {
    return ctx.processChunkSync(input, ctx.finishFlush);
  } finally {
    ctx.close(); // the matrix shares one wasm instance: free each case's zlib state
  }
}
