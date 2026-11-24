#!/usr/bin/env node
/**
 * Build the guest bundle `dist/guest.js` (ADR-0558): one IIFE — Web shim +
 * rifty runtime from workspace source + guest entry — that an embedder
 * evaluates as a classic script inside its V8 isolate.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
});
