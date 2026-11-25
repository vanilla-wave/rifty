// Preload (`--require tsx/cjs -r ./swap-binding.cjs`): Node's native `binding.Zlib` and
// `binding.crc32` → the product's, so Node's own lib/zlib.js runs on them (brotli and zstd stay
// native). lib/zlib.js reads both from `process.binding('zlib')` (= internalBinding('zlib')) when it
// loads. Must not load node:zlib: Node's tests patch buffer.kMaxLength before requiring it.
// ZLIB_ENGINE_TRACE: file that receives "<handle writes> <crc32 calls>" of this process at exit.
'use strict';
const { appendFileSync } = require('node:fs');
const { ZlibEngine } = require('../../src/zlib-engine/engine.ts');
const { createZlibBinding } = require('../../src/zlib-engine/handle.ts');
const { zlibWasmBytes } = require('../../src/zlib-engine/wasm-bytes.ts');

const product = createZlibBinding(() => new ZlibEngine(zlibWasmBytes()), setImmediate);
const { Zlib } = product;
let crc32 = product.crc32;
const trace = process.env.ZLIB_ENGINE_TRACE;
if (trace) {
  let writes = 0;
  let crcs = 0;
  for (const m of ['write', 'writeSync']) {
    const f = Zlib.prototype[m];
    Zlib.prototype[m] = function (...a) {
      writes++;
      return f.apply(this, a);
    };
  }
  crc32 = (data, value) => {
    crcs++;
    return product.crc32(data, value);
  };
  process.on('exit', () => appendFileSync(trace, `${writes} ${crcs}\n`));
}
const binding = process.binding('zlib');
binding.Zlib = Zlib;
binding.crc32 = crc32;
