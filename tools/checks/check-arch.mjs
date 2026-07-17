import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPCRUISE = fileURLToPath(
  new URL('../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs', import.meta.url),
);
const CONFIGS = ['.dependency-cruiser.cjs', '.dependency-cruiser-boundaries.cjs'];

const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--output-type');
const outputType = jsonIndex === -1 ? 'err' : args[jsonIndex + 1];
if (jsonIndex !== -1) args.splice(jsonIndex, 2);
if (outputType !== 'err' && outputType !== 'json') {
  throw new Error(`check:arch supports only err and json output, received ${String(outputType)}`);
}
if (args.length === 0) throw new Error('check:arch requires at least one file or directory');

function cruise(config) {
  const child = spawnSync(
    process.execPath,
    [DEPCRUISE, '--config', config, '--output-type', 'json', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (child.error) throw child.error;
  if (child.status !== 0 && child.status !== 1) {
    process.stderr.write(child.stderr);
    throw new Error(
      `dependency-cruiser failed for ${config} with exit code ${String(child.status)}`,
    );
  }
  return JSON.parse(child.stdout);
}

const runtime = cruise(CONFIGS[0]);
const policy = cruise(CONFIGS[1]);
const violations = [...runtime.summary.violations, ...policy.summary.violations];
const result = {
  ...policy,
  summary: {
    ...policy.summary,
    violations,
    error: violations.filter(({ rule }) => rule.severity === 'error').length,
    warn: violations.filter(({ rule }) => rule.severity === 'warn').length,
    info: violations.filter(({ rule }) => rule.severity === 'info').length,
  },
};

if (outputType === 'json') {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (violations.length === 0) {
  process.stdout.write('check:arch: runtime topology and compile-time dependency policy OK\n');
} else {
  for (const violation of violations) {
    process.stderr.write(
      `${violation.rule.severity} ${violation.rule.name}: ${violation.from} → ${violation.to}\n`,
    );
  }
}

process.exitCode = violations.some(({ rule }) => rule.severity === 'error') ? 1 : 0;
