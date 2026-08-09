#!/usr/bin/env node
/**
 * Local static/build/unit/parity PR gate. Browser lanes run separately.
 * Tasks run sequentially — test:run and test:parity each saturate every core;
 * scheduled concurrently they time-fail each other. Any failure fails the gate.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, command: string, args?: string[] }} Task */
/** @typedef {{ name: string, code: number, output: string, durationMs: number }} Result */

function runOne(/** @type {Task} */ task) {
  return new Promise((/** @type {(r: Result) => void} */ resolve) => {
    const started = Date.now();
    const child = spawn(task.command, task.args ?? [], { env: process.env });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    const done = (/** @type {number} */ code) =>
      resolve({ name: task.name, code, output, durationMs: Date.now() - started });
    child.on('error', (err) => {
      output += `\n${err.message}`;
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

/**
 * Run tasks one at a time in declaration order.
 * @param {Task[]} tasks
 * @param {{ onResult?: (r: Result) => void }} [opts]
 * @returns {Promise<{ results: Result[], ok: boolean }>}
 */
export async function runChecks(tasks, { onResult } = {}) {
  /** @type {Result[]} */
  const results = [];
  for (const task of tasks) {
    const result = await runOne(task);
    results.push(result);
    onResult?.(result);
  }
  return { results, ok: results.every((r) => r.code === 0) };
}

// Playwright lanes are not here:
// they spin up browser workers + a vite dev server and, run alongside these,
// starve the timing-sensitive parity/stream checks. Run them separately:
// `pnpm test:e2e` and `pnpm test:browser-unit` (CI keeps its own e2e-chromium
// and browser-unit-chromium jobs). All tasks below are mutually independent.
/** @type {Task[]} */
const TASKS = [
  'lint',
  'typecheck',
  'build:libs',
  'check:arch',
  'check:parity-coverage',
  'check:e2e-coverage',
  // Generated artifacts must match their inventories.
  'check:compat-drift',
  'check:esbuild-runtime-drift',
  'check:shadow-catalog-drift',
  'check:install-artifact-drift',
  'check:snapshot-artifact-drift',
  'check:publish-config-drift',
  'check:source-grep',
  'check:dir-owner',
  'check:file-size',
  'check:contract-drift',
  'check:goal-contract',
  'check:budget',
  'check:install-stamp-writers',
  'check:runtime-adapter-boundary',
  'check:esbuild-legacy-retirement',
  'check:sync-sha256-cores',
  'backlog:check',
  'refs:check',
  'test:run',
  'test:parity',
].map((name) => ({ name, command: 'pnpm', args: ['run', name] }));

async function main() {
  console.log(`pr:check — ${TASKS.length} checks, sequential\n`);
  const { results, ok } = await runChecks(TASKS, {
    onResult: (r) => {
      const mark = r.code === 0 ? '✓' : '✗';
      console.log(`  ${mark} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
    },
  });
  const failed = results.filter((r) => r.code !== 0);
  for (const r of failed) {
    console.log(`\n${'─'.repeat(60)}\n✗ ${r.name}\n${'─'.repeat(60)}\n${r.output.trimEnd()}`);
  }
  console.log(
    `\n${ok ? '✓ pr:check passed' : `✗ pr:check failed (${failed.length}/${results.length}): ${failed.map((r) => r.name).join(', ')}`}`,
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
