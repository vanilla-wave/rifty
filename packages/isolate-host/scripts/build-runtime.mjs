#!/usr/bin/env node
/**
 * Build the non-API artifacts the package loads (ADR-0557 §4, ADR-0568): `dist/child.js`
 * (Node ESM, isolated-vm external) and `dist/guest.js` — the export's bundle
 * `@riftydev/isolate-guest/guest.js`, copied byte for byte (ADR-0558), so the
 * host tarball stays self-contained; `dist/codec.js`, rifty's MemoryFs and the
 * snapshot codec for the consumer realm.
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
// The consumer realm's MemoryFs + snapshot codec (ADR-0568 §2), loaded by `src/sandbox.ts`.
await build({
  absWorkingDir: root,
  entryPoints: ['src/codec.ts'],
  outfile: 'dist/codec.js',
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  platform: 'node',
  format: 'esm',
});
