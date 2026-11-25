// Preload: replace Node's native `binding.Zlib` handle with driver.mjs's ZlibContext over a probe
// engine, so Node's own lib/zlib.js (streams, sync, callbacks, params, flush, info, bytesWritten,
// maxOutputLength, …) runs unchanged on that engine. Brotli/Zstd stay native.
// usage: ZLIB_PROBE_ENGINE=<name> ZLIB_PROBE_DEPS=<dir> ZLIB_PROBE_BUILD=<dir> node -r ./swap-binding.cjs …
'use strict';
const { makeHandleClass } = require('./handle.cjs');
const { loadEngines } = require('./engines.mjs');

const name = process.env.ZLIB_PROBE_ENGINE;
const engine = loadEngines(process.env.ZLIB_PROBE_DEPS, process.env.ZLIB_PROBE_BUILD)[name];
if (!engine) throw new Error(`swap-binding: unknown engine ${name}`);
const binding = process.binding('zlib'); // same object as internalBinding('zlib') for this allow-listed module
binding.Zlib = makeHandleClass(engine);
