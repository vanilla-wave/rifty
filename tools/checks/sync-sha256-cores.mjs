#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_ROOTS = ['apps', 'packages', 'services', 'tools'];
const CORE_FINGERPRINTS = [
  /\b0x428a2f98\b/iu,
  /\b0x71374491\b/iu,
  /\b0x6a09e667\b/iu,
  /\b0xbb67ae85\b/iu,
];
const MARKER = 'ADR-0312-SYNC-SHA256-CORE:';
const EXPECTED_HELPERS = [
  'packages/workbench/src/glue/install-stamp.ts',
  'tools/shadow-registry/src/internal/sync-sha256.ts',
];
const EXPECTED = ['packages/runtime-js/src/builtins/crypto.ts', ...EXPECTED_HELPERS].sort();
const HELPER_SET = new Set(EXPECTED_HELPERS);

function* sourceFiles(path) {
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const target = join(path, name);
    if (statSync(target).isDirectory()) yield* sourceFiles(target);
    else if (
      /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(name) &&
      !/\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/u.test(name)
    )
      yield target;
  }
}

const matches = [];
for (const root of SOURCE_ROOTS) {
  for (const file of sourceFiles(join(ROOT, root))) {
    const source = readFileSync(file, 'utf8');
    if (!CORE_FINGERPRINTS.every((fingerprint) => fingerprint.test(source))) continue;
    const path = relative(ROOT, file);
    if (HELPER_SET.has(path) && !source.includes(MARKER)) {
      throw new Error(`${path} has a package-private sync SHA-256 helper without ${MARKER}`);
    }
    matches.push(path);
  }
}
matches.sort();
if (JSON.stringify(matches) !== JSON.stringify(EXPECTED)) {
  throw new Error(
    `ADR-0312 sync SHA-256 core set drifted: expected ${EXPECTED.join(', ')}, got ${matches.join(', ')}`,
  );
}
console.log(
  `sync-sha256-cores: ${matches.length} admitted implementations (${EXPECTED_HELPERS.length} package-private helpers + runtime-js builtin)`,
);
