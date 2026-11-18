#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/**
 * Build the two non-API artifacts `runCode` loads (ADR-0557 §4): `dist/child.js`
 * (Node ESM, isolated-vm external) and `dist/guest.js` (one IIFE: shim + rifty
 * runtime from workspace source, evaluated inside the isolate).
 */
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const common = {
  absWorkingDir: root,
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/child/main.ts'],
    outfile: 'dist/child.js',
    platform: 'node',
    format: 'esm',
    external: ['isolated-vm'],
  }),
  build({
    ...common,
    entryPoints: ['src/guest/entry.ts'],
    // Runtime modules capture timers/codecs at load: the shim evaluates first,
    // whatever the entry's (formatter-sorted) import order.
    inject: ['src/guest/web-shim.ts'],
    outfile: 'dist/guest.js',
    platform: 'browser',
    format: 'iife',
    // The QuickJS vm engine's emscripten loader imports node:module lazily; in
    // the isolate that import rejects ("Not supported") — node:vm is a ceiling here.
    external: ['node:module'],
  }),
]);
