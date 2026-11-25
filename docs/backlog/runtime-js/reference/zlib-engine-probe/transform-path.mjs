// What Node's one-shot and sync zlib paths take from `Transform`, and what rifty's `Transform` gives
// today. Node v24.16.0 lib/zlib.js's ZlibBase/Zlib/zlibBuffer/zlibBufferSync/processChunk(Sync)/
// processCallback/zlibOnError/_destroy, ported near-verbatim (MIT, Copyright Node.js contributors)
// over a `Transform` parameter and the probe handle (wasm engine). Three columns per scenario:
//   node   — Node's real zlib classes (native handle) + the same zlibBuffer;
//   port/N — this port over Node's stream.Transform (validates the port against `node`);
//   port/R — this port over rifty's @riftydev/io Transform (main): the difference is rifty's streams.
// usage: node --import tsx transform-path.mjs DEPS BUILD REPO
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import nodeStream from 'node:stream';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { makeHandleClass } = require('./handle.cjs');
const { loadEngines } = require('./engines.mjs');
const [deps, build, repo] = process.argv.slice(2);
const engine = loadEngines(deps, build)['wasm-node-zlib'];
const rifty = await import(pathToFileURL(join(repo, 'packages/io/src/index.ts')).href);
const C = zlib.constants;
const kFlushFlag = Symbol('kFlushFlag');
const kError = Symbol('kError');
const owner = Symbol('owner_symbol');

function makeZlib(Transform, trace) {
  const Handle = makeHandleClass(engine, trace);
  const flushiness = [];
  [C.Z_NO_FLUSH, C.Z_BLOCK, C.Z_PARTIAL_FLUSH, C.Z_SYNC_FLUSH, C.Z_FULL_FLUSH, C.Z_FINISH].forEach(
    (f, i) => {
      flushiness[f] = i;
    },
  );
  const maxFlush = (a, b) => (flushiness[a] > flushiness[b] ? a : b);
  function zlibOnError(message, errno, code) {
    const self = this[owner];
    const error = Object.assign(new Error(message), { errno, code });
    self.destroy(error);
    self[kError] = error;
  }
  function ZlibBase(opts, _mode, handle, { flush, finishFlush, fullFlush }) {
    const chunkSize = opts?.chunkSize ?? C.Z_DEFAULT_CHUNK;
    Transform.call(this, { autoDestroy: true, ...opts });
    this[kError] = null;
    this.bytesWritten = 0;
    this._handle = handle;
    handle[owner] = this;
    handle.onerror = zlibOnError;
    this._outBuffer = Buffer.allocUnsafe(chunkSize);
    this._outOffset = 0;
    this._chunkSize = chunkSize;
    this._defaultFlushFlag = opts?.flush ?? flush;
    this._finishFlushFlag = opts?.finishFlush ?? finishFlush;
    this._defaultFullFlushFlag = fullFlush;
    this._info = opts?.info;
    this._maxOutputLength = opts?.maxOutputLength ?? 2 ** 32;
  }
  Object.setPrototypeOf(ZlibBase.prototype, Transform.prototype);
  Object.setPrototypeOf(ZlibBase, Transform);
  ZlibBase.prototype._flush = function (callback) {
    this._transform(Buffer.alloc(0), '', callback);
  };
  ZlibBase.prototype._final = (callback) => {
    callback();
  };
  ZlibBase.prototype.close = function () {
    this.destroy();
  };
  ZlibBase.prototype._destroy = function (err, callback) {
    _close(this);
    callback(err);
  };
  ZlibBase.prototype._transform = function (chunk, _encoding, cb) {
    let flushFlag = this._defaultFlushFlag;
    if (typeof chunk[kFlushFlag] === 'number') flushFlag = chunk[kFlushFlag];
    if (this.writableEnded && this.writableLength === chunk.byteLength)
      flushFlag = maxFlush(flushFlag, this._finishFlushFlag);
    processChunk(this, chunk, flushFlag, cb);
  };
  ZlibBase.prototype._processChunk = function (chunk, flushFlag, cb) {
    if (typeof cb === 'function') processChunk(this, chunk, flushFlag, cb);
    else return processChunkSync(this, chunk, flushFlag);
  };
  function processChunkSync(self, chunk, flushFlag) {
    let availInBefore = chunk.byteLength;
    let availOutBefore = self._chunkSize - self._outOffset;
    let inOff = 0;
    const buffers = [];
    let nread = 0;
    let inputRead = 0;
    const state = self._writeState;
    const handle = self._handle;
    let buffer = self._outBuffer;
    let offset = self._outOffset;
    const chunkSize = self._chunkSize;
    let error;
    self.on('error', (er) => {
      error = er;
    });
    for (;;) {
      handle.writeSync(flushFlag, chunk, inOff, availInBefore, buffer, offset, availOutBefore);
      if (error) throw error;
      if (self[kError]) throw self[kError];
      const availOutAfter = state[0];
      const availInAfter = state[1];
      const inDelta = availInBefore - availInAfter;
      inputRead += inDelta;
      const have = availOutBefore - availOutAfter;
      if (have > 0) {
        buffers.push(buffer.slice(offset, offset + have));
        offset += have;
        nread += have;
      }
      if (availOutAfter === 0 || offset >= chunkSize) {
        availOutBefore = chunkSize;
        offset = 0;
        buffer = Buffer.allocUnsafe(chunkSize);
      }
      if (availOutAfter === 0) {
        inOff += inDelta;
        availInBefore = availInAfter;
      } else break;
    }
    self.bytesWritten = inputRead;
    _close(self);
    return Buffer.concat(buffers, nread);
  }
  function processChunk(self, chunk, flushFlag, cb) {
    const handle = self._handle;
    if (!handle) return process.nextTick(cb);
    handle.buffer = chunk;
    handle.cb = cb;
    handle.availOutBefore = self._chunkSize - self._outOffset;
    handle.availInBefore = chunk.byteLength;
    handle.inOff = 0;
    handle.flushFlag = flushFlag;
    handle.write(
      flushFlag,
      chunk,
      0,
      handle.availInBefore,
      self._outBuffer,
      self._outOffset,
      handle.availOutBefore,
    );
  }
  function processCallback() {
    const self = this[owner];
    const state = self._writeState;
    if (self.destroyed) {
      this.buffer = null;
      this.cb();
      return;
    }
    const availOutAfter = state[0];
    const availInAfter = state[1];
    const inDelta = this.availInBefore - availInAfter;
    self.bytesWritten += inDelta;
    const have = this.availOutBefore - availOutAfter;
    let streamBufferIsFull = false;
    if (have > 0) {
      const out = self._outBuffer.slice(self._outOffset, self._outOffset + have);
      self._outOffset += have;
      streamBufferIsFull = !self.push(out);
    }
    if (self.destroyed) {
      this.cb();
      return;
    }
    if (availOutAfter === 0 || self._outOffset >= self._chunkSize) {
      this.availOutBefore = self._chunkSize;
      self._outOffset = 0;
      self._outBuffer = Buffer.allocUnsafe(self._chunkSize);
    }
    if (availOutAfter === 0) {
      this.inOff += inDelta;
      this.availInBefore = availInAfter;
      if (!streamBufferIsFull) {
        this.write(
          this.flushFlag,
          this.buffer,
          this.inOff,
          this.availInBefore,
          self._outBuffer,
          self._outOffset,
          self._chunkSize,
        );
      } else {
        trace.push('backpressure:_read-swap');
        const oldRead = self._read;
        self._read = (n) => {
          self._read = oldRead;
          this.write(
            this.flushFlag,
            this.buffer,
            this.inOff,
            this.availInBefore,
            self._outBuffer,
            self._outOffset,
            self._chunkSize,
          );
          self._read(n);
        };
      }
      return;
    }
    if (availInAfter > 0) self.push(null);
    this.buffer = null;
    this.cb();
  }
  function _close(e) {
    e._handle?.close();
    e._handle = null;
  }
  function Zlib(opts, mode) {
    let windowBits = C.Z_DEFAULT_WINDOWBITS;
    if (
      (opts?.windowBits == null || opts.windowBits === 0) &&
      (mode === 2 || mode === 4 || mode === 7)
    )
      windowBits = 0;
    else if (opts?.windowBits != null) windowBits = opts.windowBits;
    const handle = new Handle(mode);
    this._writeState = new Uint32Array(2);
    handle.init(
      windowBits,
      opts?.level ?? -1,
      opts?.memLevel ?? 8,
      opts?.strategy ?? 0,
      this._writeState,
      processCallback,
      opts?.dictionary,
    );
    ZlibBase.call(this, opts, mode, handle, {
      flush: C.Z_NO_FLUSH,
      finishFlush: C.Z_FINISH,
      fullFlush: C.Z_FULL_FLUSH,
    });
  }
  Object.setPrototypeOf(Zlib.prototype, ZlibBase.prototype);
  Object.setPrototypeOf(Zlib, ZlibBase);
  const cls = (mode) => {
    function X(opts) {
      Zlib.call(this, opts, mode);
    }
    Object.setPrototypeOf(X.prototype, Zlib.prototype);
    Object.setPrototypeOf(X, Zlib);
    return X;
  };
  return { Deflate: cls(1), Inflate: cls(2), Gzip: cls(3), Gunzip: cls(4) };
}

// lib/zlib.js zlibBuffer / zlibBufferSync verbatim (shared by all three columns).
function zlibBuffer(e, buffer, callback) {
  e.buffers = null;
  e.nread = 0;
  e.cb = callback;
  e.on('data', function (chunk) {
    if (!this.buffers) this.buffers = [chunk];
    else this.buffers.push(chunk);
    this.nread += chunk.length;
    if (this.nread > this._maxOutputLength) {
      this.close();
      this.removeAllListeners('end');
      this.cb(
        Object.assign(
          new RangeError(`Cannot create a Buffer larger than ${this._maxOutputLength} bytes`),
          { code: 'ERR_BUFFER_TOO_LARGE' },
        ),
      );
    }
  });
  e.on('error', function (err) {
    this.removeAllListeners('end');
    this.cb(err);
  });
  e.on('end', function () {
    const buf = this.nread === 0 ? Buffer.alloc(0) : Buffer.concat(this.buffers, this.nread);
    this.close();
    this.cb(null, this._info ? { buffer: buf, engine: this } : buf);
  });
  e.end(buffer);
}

const T = Buffer.from('the quick brown fox jumps over the lazy dog '.repeat(3000));
const Z = zlib.deflateSync(T);
const BAD = Buffer.from(Z);
BAD[40] ^= 0x55;
const G2 = Buffer.concat([zlib.gzipSync(T), zlib.gzipSync(T)]);
const sha = (b) => `${b.length}:${createHash('sha256').update(b).digest('hex').slice(0, 10)}`;

// Each scenario: (lib, trace) → promise of a summary; the trace collects ordered observations.
const SCENARIOS = {
  'deflate(cb) valid': (lib, t) => cbRun(lib.Deflate, {}, T, t),
  'inflate(cb) corrupt': (lib, t) => cbRun(lib.Inflate, {}, BAD, t),
  'inflate(cb) maxOutputLength 1000': (lib, t) =>
    cbRun(lib.Inflate, { maxOutputLength: 1000 }, Z, t),
  'deflate(cb) info:true': (lib, t) => cbRun(lib.Deflate, { info: true }, T, t),
  'gunzip(cb) 2 members 264 KiB out': (lib, t) => cbRun(lib.Gunzip, {}, G2, t),
  'deflateSync valid': (lib, t) => syncRun(lib.Deflate, {}, T, t),
  'inflateSync corrupt': (lib, t) => syncRun(lib.Inflate, {}, BAD, t),
};
function watch(e, t) {
  const d = e.destroy;
  e.destroy = function (...a) {
    t.push(`destroy(${a[0] ? 'err' : ''})`);
    return d.apply(this, a);
  };
  if (e._destroy && !Object.hasOwn(e, '_destroy')) {
    const own = e._destroy;
    e._destroy = function (...a) {
      t.push('_destroy');
      return own.apply(this, a);
    };
  }
  for (const ev of ['error', 'close', 'end', 'finish', 'prefinish'])
    e.on(ev, () => t.push(`event:${ev}`));
}
function cbRun(Ctor, opts, input, t) {
  return new Promise((res) => {
    const e = new Ctor(opts);
    watch(e, t);
    zlibBuffer(e, input, (err, r) => {
      t.push(
        err
          ? `cb(err ${err.code ?? err.name}: ${err.message})`
          : `cb(${r.engine ? `{buffer ${sha(r.buffer)}, engine instanceof ${r.engine instanceof Ctor}}` : sha(r)})`,
      );
      setTimeout(() => res({ destroyed: e.destroyed, handleNull: e._handle === null }), 30);
    });
  });
}
function syncRun(Ctor, opts, input, t) {
  const e = new Ctor(opts);
  watch(e, t);
  try {
    t.push(`return ${sha(e._processChunk(input, e._finishFlushFlag))}`);
  } catch (err) {
    t.push(`throw ${err.code}: ${err.message}`);
  }
  t.push('-- sync end');
  return new Promise((res) =>
    setTimeout(() => res({ destroyed: e.destroyed, handleNull: e._handle === null }), 30),
  );
}

const nodeLib = {
  Deflate: zlib.Deflate,
  Inflate: zlib.Inflate,
  Gzip: zlib.Gzip,
  Gunzip: zlib.Gunzip,
};
console.log(`node ${process.version}; rifty Transform from packages/io/src (main)`);
for (const [name, run] of Object.entries(SCENARIOS)) {
  const cols = {};
  for (const [col, mk] of [
    ['node', () => nodeLib],
    ['port/N', (t) => makeZlib(nodeStream.Transform, t)],
    ['port/R', (t) => makeZlib(rifty.Transform, t)],
  ]) {
    const t = [];
    const lib = mk(t);
    let end;
    try {
      end = await Promise.race([
        run(lib, t),
        new Promise((r) => setTimeout(() => r({ timeout: true }), 3000)),
      ]);
    } catch (err) {
      end = { threw: `${err.name}: ${err.message}` };
    }
    cols[col] =
      `${t.filter((x) => !x.startsWith('write(') && x !== 'handle.close').join(' → ')} || ${JSON.stringify(end)} || handle: ${t.filter((x) => x.startsWith('write(') || x === 'handle.close').join(' ') || '(native)'}`;
  }
  console.log(`\n## ${name}`);
  for (const [col, v] of Object.entries(cols)) console.log(`${col.padEnd(6)} ${v}`);
  console.log(
    `port/N = node: ${cols['port/N'].split(' || ').slice(0, 2).join() === cols.node.split(' || ').slice(0, 2).join()}; port/R = port/N: ${cols['port/R'] === cols['port/N']}`,
  );
}
process.exit(0);
