#!/usr/bin/env node
/**
 * Enforces ADR 0024: file-size budget.
 *
 * Walks `packages/`, `apps/`, `tools/` for `.ts` / `.tsx` files and flags any
 * file over LIMIT lines that is not in the EXCEPTIONS allow-list. Exceptions
 * are documented in `docs/adr/0024-file-size-budget.md`.
 *
 * Intended to be wired into CI / pnpm scripts (see ADR 0024 follow-ups).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const LIMIT = 300;
const ROOTS = ['packages', 'apps', 'tools'];
const EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next']);

// Documented in docs/adr/0024-file-size-budget.md. Keys are repo-relative
// paths using forward slashes.
const EXCEPTIONS = new Set([
  // Originally enumerated in ADR 0024.
  'packages/runtime-js/src/module-loader/resolver.ts',
  'packages/runtime-js/src/module-loader/esm-ast-walker.ts',
  // Note: `runtime-js/src/builtins/stream.ts` and `.../buffer.ts` were
  // EXCEPTIONS until ADR-0012 promoted the primitives into `@rifty/io` —
  // both became thin re-export shims and dropped under 300 lines.
  //
  // Additional pre-existing drift discovered when the budget check was
  // rolled out (2026-05-24). Each is documented in ADR 0024; reviewers
  // should challenge any growth and split when practical.
  'packages/runtime-js/src/builtins/crypto.ts',
  'packages/runtime-js/src/builtins/fs.ts',
  'packages/runtime-js/src/module-loader/esm-ast.ts',
]);

const repoRoot = process.cwd();

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      const dot = full.lastIndexOf('.');
      if (dot !== -1 && EXTS.has(full.slice(dot))) out.push(full);
    }
  }
  return out;
}

function toRelPosix(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

const offenders = [];
const seenExceptions = new Set();

for (const root of ROOTS) {
  for (const file of walk(join(repoRoot, root))) {
    const lines = readFileSync(file, 'utf8').split('\n').length;
    if (lines <= LIMIT) continue;
    const rel = toRelPosix(file);
    if (EXCEPTIONS.has(rel)) {
      seenExceptions.add(rel);
      continue;
    }
    offenders.push({ file: rel, lines });
  }
}

if (offenders.length > 0) {
  console.error(
    `file-budget: ${offenders.length} file(s) exceed ${LIMIT} lines without documented exception:`,
  );
  for (const { file, lines } of offenders) console.error(`  ${file} — ${lines} lines`);
  console.error(
    'Either split the file or add it to EXCEPTIONS in tools/checks/file-budget.mjs ' +
      'and document the reason in docs/adr/0024-file-size-budget.md.',
  );
  process.exit(1);
}

// Stale exception detection — if an entry was removed organically, warn so
// the ADR can be updated. Non-fatal: keeps CI green.
const stale = [...EXCEPTIONS].filter((e) => !seenExceptions.has(e));
if (stale.length > 0) {
  console.warn(
    `file-budget: ${stale.length} documented exception(s) no longer exceed ${LIMIT} lines (remove from EXCEPTIONS and ADR 0024):`,
  );
  for (const f of stale) console.warn(`  ${f}`);
}

console.log(`file-budget: ok (${seenExceptions.size}/${EXCEPTIONS.size} documented exception(s))`);
