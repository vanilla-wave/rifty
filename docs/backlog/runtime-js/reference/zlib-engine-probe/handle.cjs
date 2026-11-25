// Shape of Node.js v24.16.0 src/node_zlib.cc ZlibStream — Copyright Node.js contributors, MIT.
// Node's native zlib handle (node_zlib.cc ZlibStream) over a probe engine: init/write/writeSync/
// params/reset/close, `_writeState` via writeResult, errors through `onerror`. Used by swap-binding.cjs
// (Node's own lib/zlib.js) and zlib-diff.mjs. `trace` (optional) records handle calls.
'use strict';
const { Context, ZlibError } = require('./driver.mjs');

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

function makeHandleClass(engine, trace = null) {
  return class Zlib {
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
      trace?.push(`write(${flush})`);
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
      trace?.push('handle.close');
      if (this.writing) {
        this.pendingClose = true;
        return;
      }
      this.ctx?.close();
    }
    getAsyncId() {
      return -1;
    }
  };
}
module.exports = { makeHandleClass, MODE_NAMES };
