#!/usr/bin/env node
/**
 * Build the guest bundle `dist/guest.js` (ADR-0558): one IIFE — Web shim +
 * rifty runtime from workspace source + guest entry — that an embedder
 * evaluates as a classic script inside its V8 isolate.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// cjs-module-lexer's ESM entry instantiates a wasm build at load; its CommonJS
// entry is the same lexer in plain JS. The bundle needs no WebAssembly: an
// embedder may remove it (isolate-host does, ADR-0563 §7).
const lexer = createRequire(
  fileURLToPath(new URL('../../runtime-js/package.json', import.meta.url)),
).resolve('cjs-module-lexer');

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/guest/entry.ts'],
  // Runtime modules capture timers/codecs at load: the shim evaluates first,
  // whatever the entry's (formatter-sorted) import order.
  inject: ['src/guest/web-shim.ts'],
  outfile: 'dist/guest.js',
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  platform: 'browser',
  format: 'iife',
  // The QuickJS vm engine's emscripten loader imports node:module lazily; in
  // the isolate that import rejects ("Not supported") — node:vm is a ceiling here.
  external: ['node:module'],
  alias: { 'cjs-module-lexer': lexer },
});
