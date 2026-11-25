// Bundle Node v24.16.0's own JS for EventTarget/Event/CustomEvent, AbortController/AbortSignal,
// DOMException and the WHATWG streams (lib/internal/*) into one IIFE for a bare V8 isolate.
// Verbatim Node files + `primordials` built by Node's own per_context/primordials.js; only the
// modules Node implements in C++ or that pull the rest of Node (errors' inspect, util, timers,
// worker transfer) are small shims in ./shims. Probe only (docs/backlog/epics/isolate-guest-web-api).
//   node build.mjs <node-lib-dir> <out.js>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
// Third argument `events`: EventTarget/Event/CustomEvent/AbortController/AbortSignal/DOMException only;
// `primordials` / `errors`: that module alone (cost breakdown).
const [lib, out, only] = process.argv.slice(2);
// Ported verbatim from lib/internal/<name>.js.
const PORT = new Set([
  'per_context/domexception',
  'event_target',
  'abort_controller',
  'events/abort_listener',
  'webidl',
  'validators',
  'errors',
  'streams/utils',
  'util/types',
  'webstreams/readablestream',
  'webstreams/writablestream',
  'webstreams/transformstream',
  'webstreams/queuingstrategies',
  'webstreams/util',
  'webstreams/encoding',
]);
const PRELUDE =
  "const primordials = require('#primordials'); const internalBinding = require('#binding');" +
  " const { privateSymbols, perIsolateSymbols } = require('#symbols');\n";
const EVENTS = `const et = require('internal/event_target');
const ac = require('internal/abort_controller');
const { DOMException } = require('internal/per_context/domexception');
globalThis.__nodePort = {
  EventTarget: et.EventTarget, Event: et.Event, CustomEvent: et.CustomEvent,
  AbortController: ac.AbortController, AbortSignal: ac.AbortSignal, DOMException,
};`;
const FULL = `const et = require('internal/event_target');
const ac = require('internal/abort_controller');
const rs = require('internal/webstreams/readablestream');
const ws = require('internal/webstreams/writablestream');
const ts = require('internal/webstreams/transformstream');
const qs = require('internal/webstreams/queuingstrategies');
const enc = require('internal/webstreams/encoding');
const { DOMException } = require('internal/per_context/domexception');
globalThis.__nodePort = {
  EventTarget: et.EventTarget, Event: et.Event, CustomEvent: et.CustomEvent,
  AbortController: ac.AbortController, AbortSignal: ac.AbortSignal, DOMException,
  ReadableStream: rs.ReadableStream, ReadableStreamDefaultReader: rs.ReadableStreamDefaultReader,
  ReadableStreamBYOBReader: rs.ReadableStreamBYOBReader, ReadableStreamBYOBRequest: rs.ReadableStreamBYOBRequest,
  ReadableByteStreamController: rs.ReadableByteStreamController,
  ReadableStreamDefaultController: rs.ReadableStreamDefaultController,
  WritableStream: ws.WritableStream, WritableStreamDefaultWriter: ws.WritableStreamDefaultWriter,
  WritableStreamDefaultController: ws.WritableStreamDefaultController,
  TransformStream: ts.TransformStream, TransformStreamDefaultController: ts.TransformStreamDefaultController,
  ByteLengthQueuingStrategy: qs.ByteLengthQueuingStrategy, CountQueuingStrategy: qs.CountQueuingStrategy,
  TextEncoderStream: enc.TextEncoderStream, TextDecoderStream: enc.TextDecoderStream,
};`;
const ported = [];
const anchor = (src, before, after) => {
  if (src.split(before).length !== 2) throw new Error(`anchor drift: ${before}`);
  return src.replace(before, after);
};
const result = await build({
  stdin: {
    contents:
      {
        events: EVENTS,
        primordials: "globalThis.__nodePort = require('#primordials');",
        errors: "globalThis.__nodePort = require('internal/errors');",
      }[only] ?? FULL,
    resolveDir: here,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'neutral',
  target: 'es2022',
  minify: process.env.PORT_MINIFY !== '0',
  keepNames: true,
  logLevel: 'error',
  plugins: [
    {
      name: 'node-internal',
      setup(b) {
        b.onResolve(
          { filter: /^(internal\/.*|util|events|timers|buffer|path|#.*)$/ },
          ({ path }) => ({
            path: path.startsWith('internal/')
              ? path.slice(9)
              : path.startsWith('#')
                ? path
                : `@${path}`,
            namespace: 'node',
          }),
        );
        b.onLoad({ filter: /.*/, namespace: 'node' }, ({ path }) => {
          if (path === '#primordials') {
            const src = readFileSync(join(lib, 'per_context/primordials.js'), 'utf8');
            ported.push('per_context/primordials');
            return {
              // The tail edits primordials before Node's own ObjectFreeze(primordials).
              contents: `const primordials = {};\n(function(){${anchor(src, 'ObjectFreeze(primordials);', `${readFileSync(join(here, 'shims/#primordials-tail.js'), 'utf8')}\nObjectFreeze(primordials);`)}\n})();\nmodule.exports = primordials;`,
              loader: 'js',
              resolveDir: here,
            };
          }
          if (PORT.has(path)) {
            ported.push(path);
            return {
              contents: PRELUDE + readFileSync(join(lib, `${path}.js`), 'utf8'),
              loader: 'js',
              resolveDir: here,
            };
          }
          const shim = join(here, 'shims', `${path.replaceAll('/', '__')}.js`);
          if (!existsSync(shim)) throw new Error(`no shim for ${path}`);
          const head = path.startsWith('#') ? '' : PRELUDE;
          return { contents: head + readFileSync(shim, 'utf8'), loader: 'js', resolveDir: here };
        });
      },
    },
  ],
});
writeFileSync(out, result.outputFiles[0].text);
console.log(
  JSON.stringify({
    out,
    bytes: result.outputFiles[0].contents.length,
    ported: [...new Set(ported)].sort(),
  }),
);
