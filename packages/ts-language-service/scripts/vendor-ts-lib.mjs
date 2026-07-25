#!/usr/bin/env node

// Build-time vendoring of the TypeScript standard-library declaration files.
//
// Reads every `lib*.d.ts` from the INSTALLED `typescript` package's `lib/` dir
// (the version pinned in this package's `dependencies` — ADR-0166: the vendored
// fixed compiler is the single source of truth for both the compiler AND its lib
// files) and emits a single JSON map `{ "lib.es5.d.ts": "<contents>", … }` to the
// committed vendored asset `vendor/lib-bundle.json`.
//
// The browser loader fetches this bundle once (it has no `node:fs`); Node reads
// the same files directly. Re-run after bumping the pinned `typescript` version:
//   pnpm vendor:ts-lib   (also runs automatically via `prebuild`).
//
// Why all libs, not just the configured target: a project may `lib`-target any
// of es5..esnext/dom/webworker — for fidelity we vendor the whole set (large is
// fine; fetched once and pinned to the workspace compiler — ADR-0166/0177).
//
// Zero non-builtin deps; `createRequire` to resolve the installed compiler dir.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const OUT_DIR = join(PKG_ROOT, 'vendor');
const OUT_FILE = join(OUT_DIR, 'lib-bundle.json');

// Only the standard-library declarations (`lib.*.d.ts`). Excludes the compiler's
// own internal `.d.ts` (typescript.d.ts etc.) which are not lib files.
const LIB_RE = /^lib(\.[^.]+)*\.d\.ts$/;

/** Resolve the `lib/` dir of the typescript install this package depends on. */
function resolveTsLibDir() {
  const require = createRequire(join(PKG_ROOT, 'package.json'));
  // typescript's package.json → its install root → `lib/`.
  const tsPkgJson = require.resolve('typescript/package.json');
  return join(dirname(tsPkgJson), 'lib');
}

function main() {
  const libDir = resolveTsLibDir();
  const entries = readdirSync(libDir).filter((name) => LIB_RE.test(name));
  if (entries.length === 0) {
    throw new Error(`no lib*.d.ts files found in ${libDir} — is typescript installed?`);
  }
  entries.sort();

  /** @type {Record<string, string>} */
  const bundle = {};
  for (const name of entries) {
    bundle[name] = readFileSync(join(libDir, name), 'utf8');
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Stable key order (entries are pre-sorted) for deterministic diffs.
  const out = `${JSON.stringify(bundle, null, 0)}\n`;
  writeFileSync(OUT_FILE, out, 'utf8');

  const bytes = Buffer.byteLength(out);
  process.stdout.write(
    `Wrote ${OUT_FILE}: ${entries.length} lib files, ${(bytes / 1024 / 1024).toFixed(2)} MB\n`,
  );
}

main();
