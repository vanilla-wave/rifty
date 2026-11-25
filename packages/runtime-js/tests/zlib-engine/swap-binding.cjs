// Preload (`--require tsx/cjs -r ./swap-binding.cjs`): Node's native `binding.Zlib` → the product
// handle, so Node's own lib/zlib.js runs on it (brotli, zstd and `binding.crc32` stay native).
// `process.binding('zlib')` is the object lib/zlib.js reads `Zlib` from at construction. Must not
// load node:zlib: Node's tests patch buffer.kMaxLength before requiring it. ZLIB_ENGINE_TRACE: file
// that receives this process's handle write count at exit.
'use strict';
const { appendFileSync } = require('node:fs');
const { ZlibEngine } = require('../../src/zlib-engine/engine.ts');
const { createZlibBinding } = require('../../src/zlib-engine/handle.ts');
const { zlibWasmBytes } = require('../../src/zlib-engine/wasm-bytes.ts');

const { Zlib } = createZlibBinding(() => new ZlibEngine(zlibWasmBytes()), setImmediate);
const trace = process.env.ZLIB_ENGINE_TRACE;
if (trace) {
  let writes = 0;
  for (const m of ['write', 'writeSync']) {
    const f = Zlib.prototype[m];
    Zlib.prototype[m] = function (...a) {
      writes++;
      return f.apply(this, a);
    };
  }
  process.on('exit', () => appendFileSync(trace, `${writes}\n`));
}
process.binding('zlib').Zlib = Zlib;
