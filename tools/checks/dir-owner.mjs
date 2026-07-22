#!/usr/bin/env node
/**
 * Directory owner-doc gate (AGENTS.md §Architecture).
 *
 * "Size alone ≠ trigger" left mass ungoverned: `glue/` reached 101 direct prod
 * modules — and five sibling correlation engines — before any rule fired. This
 * gate does not cap size; it requires an owner rule once a source dir crosses
 * the threshold: a `README.md` stating what belongs there and what doesn't. A
 * dir no rule can describe is not a layer — split it instead.
 *
 * Scope = direct (non-recursive) prod modules per dir with a `src` path
 * segment; tests, specs, `.d.ts`, and test-support dirs don't count.
 */
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLD = 30;
export const SCAN_ROOTS = ['apps', 'packages', 'services', 'tools'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
  'tests',
  '__tests__',
  '__mocks__',
  'fixtures',
]);
const PROD_RE = /\.[tj]sx?$/;
const NON_PROD_RE = /\.(test|spec)\.[tj]sx?$|\.d\.ts$/;

/** Direct prod-module count + README presence for every dir under `rel` whose
 *  path contains a `src` segment.
 *  @returns {{ dir: string, count: number, hasReadme: boolean }[]} */
export function measureSrcDirs(root, rel) {
  const entries = readdirSync(join(root, rel), { withFileTypes: true });
  const results = [];
  if (rel.split(sep).includes('src')) {
    const count = entries.filter(
      (e) => e.isFile() && PROD_RE.test(e.name) && !NON_PROD_RE.test(e.name),
    ).length;
    const hasReadme = entries.some((e) => e.isFile() && e.name.toLowerCase() === 'readme.md');
    results.push({ dir: rel, count, hasReadme });
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    results.push(...measureSrcDirs(root, join(rel, e.name)));
  }
  return results;
}

/** @param {{ dir: string, count: number, hasReadme: boolean }[]} measured
 *  @returns {string[]} violations (empty = pass) */
export function evaluate(measured, threshold = THRESHOLD) {
  return measured
    .filter((m) => m.count > threshold && !m.hasReadme)
    .map(
      (m) =>
        `${m.dir}: ${m.count} direct prod modules without an owner README.md — state what belongs here and what doesn't, or split the directory (AGENTS.md §Architecture)`,
    );
}

function main() {
  const root = process.cwd();
  const measured = [];
  for (const scanRoot of SCAN_ROOTS) {
    try {
      readdirSync(join(root, scanRoot));
    } catch {
      continue;
    }
    measured.push(...measureSrcDirs(root, scanRoot));
  }
  const violations = evaluate(measured);
  const top = measured.filter((m) => m.count > THRESHOLD).sort((a, b) => b.count - a.count);
  console.log(`dir-owner: ${top.length} dir(s) over ${THRESHOLD} direct prod modules`);
  for (const m of top) {
    console.log(`  ${String(m.count).padStart(4)}  ${m.hasReadme ? 'README' : '  —   '}  ${m.dir}`);
  }
  if (violations.length > 0) {
    console.error(`dir-owner: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('dir-owner: OK');
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
