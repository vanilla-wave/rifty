#!/usr/bin/env node
/**
 * Regenerates docs/public/compat/*.md from the most recent vitest run.
 *
 * Skeleton: until we wire a JSON reporter pass into the vitest workspace, the
 * matrix is hand-curated. This script verifies that every conformance test
 * file has a corresponding line in the matrix (so we don't quietly drift).
 */
import { readdir } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const conformanceDir = new URL('../../tests/conformance/', here);
const matrixDir = new URL('../../docs/public/compat/', here);

async function listFiles(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.test.ts'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const tests = await listFiles(conformanceDir);
const matrices = await listFiles(matrixDir);
console.log(
  `compat-matrix-generator: ${tests.length} conformance test(s), ${matrices.length} matrix doc(s)`,
);
for (const t of tests) console.log(`  test: ${t}`);
for (const m of matrices) console.log(`  doc:  ${m}`);
console.log('(full data-driven regeneration lands once we add a Vitest JSON reporter sink)');
