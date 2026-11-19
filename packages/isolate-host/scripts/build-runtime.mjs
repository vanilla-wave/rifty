#!/usr/bin/env node
/**
 * Build the two non-API artifacts `runCode` loads (ADR-0557 §4): `dist/child.js`
 * (Node ESM, isolated-vm external) and `dist/guest.js` — the export's bundle
 * `@riftydev/isolate-guest/guest.js`, copied byte for byte (ADR-0558), so the
 * host tarball stays self-contained.
 */
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
copyFileSync(
  createRequire(import.meta.url).resolve('@riftydev/isolate-guest/guest.js'),
  `${root}/dist/guest.js`,
);
await build({
  absWorkingDir: root,
  entryPoints: ['src/child/main.ts'],
  outfile: 'dist/child.js',
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  platform: 'node',
  format: 'esm',
  external: ['isolated-vm'],
});
