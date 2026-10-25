// Differential fuzz (overrides-bare-version-spec, ADR-0451 decision 5):
// rifty's ported loose recognizer vs the host npm's own bundled node-semver
// `validRange(spec, true)`. Deterministic LCG over range-ish fragments.
// Run: npx tsx docs/backlog/npm-client/reference/overrides-bare-version-spec-grammar-fuzz.mjs <seed> <count>
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isLooseSemverRange } from '../../../../packages/npm-client/src/semver-loose-range.ts';

const npmRoot = join(spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout.trim(), 'npm');
const requireNpm = createRequire(join(npmRoot, 'package.json'));
const semver = requireNpm('semver');
const semverVersion = requireNpm('semver/package.json').version;

const parts = [
  ...['1', '0', '2', '10', '01', 'x', 'X', '*', '.', '.', '.', '-', '-', '+', '^', '~', '~>'],
  ...['>', '<', '=', '>=', '<=', 'v', '||', ' ', ' ', ' ', '  ', 'a', 'beta', 'rc', 'foo'],
  ...['@', '/', '_', '\t', '1.2.3', '8.0.16', 'latest'],
];
let seed = Number(process.argv[2] ?? 1);
const count = Number(process.argv[3] ?? 300000);
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// semver throws past Number.MAX_SAFE_INTEGER (16+ digit runs): unmodelled.
const overflow = (spec) => /\d{16,}/.test(spec);
const mismatches = [];
let ranges = 0;
let unmodelled = 0;
for (let i = 0; i < count; i++) {
  let spec = '';
  for (let j = 1 + Math.floor(next() * 8); j > 0; j--) {
    spec += parts[Math.floor(next() * parts.length)];
  }
  const npm = semver.validRange(spec, true) !== null;
  if (npm) ranges++;
  if (npm === isLooseSemverRange(spec)) continue;
  if (overflow(spec)) unmodelled++;
  else mismatches.push(spec);
}
process.stdout.write(
  `${JSON.stringify({ semver: semverVersion, seed: Number(process.argv[2] ?? 1), count, ranges, unmodelled, mismatches })}\n`,
);
