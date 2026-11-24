// Preload: replace Node's native `binding.Zlib` handle with driver.mjs's ZlibContext over a probe
// engine, so Node's own lib/zlib.js (streams, sync, callbacks, params, flush, info, bytesWritten,
// maxOutputLength, …) runs unchanged on that engine. Brotli/Zstd stay native.
// usage: ZLIB_PROBE_ENGINE=<name> ZLIB_PROBE_DEPS=<dir> ZLIB_PROBE_BUILD=<dir> node -r ./swap-binding.cjs …
'use strict';
const { Context, ZlibError } = require('./driver.mjs');
const { loadEngines } = require('./engines.mjs');

const name = process.env.ZLIB_PROBE_ENGINE;
const engine = loadEngines(process.env.ZLIB_PROBE_DEPS, process.env.ZLIB_PROBE_BUILD)[name];
if (!engine) throw new Error(`swap-binding: unknown engine ${name}`);
const MODE_NAMES = [
  null,
  'DEFLATE',
  'INFLATE',
  'GZIP',
  'GUNZIP',
  'DEFLATERAW',
  'INFLATERAW',
  'UNZIP',
];
const binding = process.binding('zlib'); // same object as internalBinding('zlib') for this allow-listed module

class Zlib {
  constructor(mode) {
    this.modeName = MODE_NAMES[mode];
    this.ctx = null;
    this.writing = false;
  }
  init(windowBits, level, memLevel, strategy, writeResult, writeCallback, dictionary) {
    this.writeResult = writeResult;
    this.writeCallback = writeCallback;
    this.ctx = new Context(engine, this.modeName, {
      windowBits,
      level,
      memLevel,
      strategy,
      dictionary: dictionary ?? undefined,
    });
  }
  work(flush, input, inOff, inLen, out, outOff, outLen) {
    const inBytes =
      input === null
        ? new Uint8Array(0)
        : new Uint8Array(input.buffer, input.byteOffset + inOff, inLen);
    const r = this.ctx.write(flush, inBytes, outLen);
    out.set(r.out, outOff);
    this.writeResult[0] = r.availOut;
    this.writeResult[1] = r.availIn;
  }
  emit(e) {
    this.onerror(e.message, e.errno, e.code);
  }
  writeSync(...args) {
    try {
      this.work(...args);
    } catch (e) {
      if (!(e instanceof ZlibError)) throw e;
      this.emit(e);
    }
  }
  write(...args) {
    this.writing = true;
    setImmediate(() => {
      this.writing = false;
      try {
        this.work(...args);
      } catch (e) {
        if (!(e instanceof ZlibError)) throw e;
        this.emit(e);
        if (this.pendingClose) this.close();
        return;
      }
      this.writeCallback.call(this);
      if (this.pendingClose) this.close();
    });
  }
  params(level, strategy) {
    try {
      this.ctx.params(level, strategy);
    } catch (e) {
      if (!(e instanceof ZlibError)) throw e;
      this.emit(e);
    }
  }
  reset() {
    if (this.writing) throw new Error('Cannot reset zlib stream while a write is in progress');
    try {
      this.ctx.reset();
    } catch (e) {
      if (!(e instanceof ZlibError)) throw e;
      this.emit(e);
    }
  }
  close() {
    if (this.writing) {
      this.pendingClose = true;
      return;
    }
    this.ctx?.close();
  }
  getAsyncId() {
    return -1;
  }
}
binding.Zlib = Zlib;
