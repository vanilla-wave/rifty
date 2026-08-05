#!/usr/bin/env node
/**
 * Local static/build/unit/parity PR gate. Browser lanes run separately.
 * Tasks run in parallel; any failure fails the gate.
 */
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
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
 * Run tasks with a bounded concurrency pool.
 * @param {Task[]} tasks
 * @param {{ jobs?: number, onResult?: (r: Result) => void }} [opts]
 * @returns {Promise<{ results: Result[], ok: boolean }>}
 */
export async function runChecks(tasks, { jobs = availableParallelism(), onResult } = {}) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < tasks.length; i = next++) {
      results[i] = await runOne(tasks[i]);
      onResult?.(results[i]);
    }
  }
  const pool = Array.from({ length: Math.max(1, Math.min(jobs, tasks.length)) }, worker);
  await Promise.all(pool);
  return { results, ok: results.every((r) => r.code === 0) };
}

/**
 * Keep timing-sensitive Worker suites out of the parallel static/build pool
 * and out of each other's resource envelope.
 * @param {Task[]} parallelTasks
 * @param {Task[]} serialTasks
 * @param {{ jobs?: number, onResult?: (r: Result) => void }} [opts]
 * @returns {Promise<{ results: Result[], ok: boolean }>}
 */
export async function runCheckPhases(
  parallelTasks,
  serialTasks,
  { jobs = availableParallelism(), onResult } = {},
) {
  const parallel = await runChecks(parallelTasks, { jobs, onResult });
  const serial = await runChecks(serialTasks, { jobs: 1, onResult });
  return {
    results: [...parallel.results, ...serial.results],
    ok: parallel.ok && serial.ok,
  };
}

// Playwright lanes are not here:
// they spin up browser workers + a vite dev server and, run alongside these,
// starve the timing-sensitive parity/stream checks. Run them separately:
// `pnpm test:e2e` and `pnpm test:browser-unit` (CI keeps its own e2e-chromium
// and browser-unit-chromium jobs). Static/build checks below are independent;
// Worker-heavy unit and parity suites run serially after that pool.
/** @type {Task[]} */
const PARALLEL_TASKS = [
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
  'check:contract-drift',
  'check:goal-contract',
  'check:budget',
  'check:install-stamp-writers',
  'check:runtime-adapter-boundary',
  'check:esbuild-legacy-retirement',
  'check:sync-sha256-cores',
  'backlog:check',
  'refs:check',
].map((name) => ({ name, command: 'pnpm', args: ['run', name] }));

/** @type {Task[]} */
const SERIAL_TASKS = ['test:run', 'test:parity'].map((name) => ({
  name,
  command: 'pnpm',
  args: ['run', name],
}));

async function main() {
  const jobs = availableParallelism();
  const taskCount = PARALLEL_TASKS.length + SERIAL_TASKS.length;
  console.log(
    `pr:check — ${String(taskCount)} checks, up to ${String(jobs)} static/build in parallel; 2 Worker suites serial\n`,
  );
  const { results, ok } = await runCheckPhases(PARALLEL_TASKS, SERIAL_TASKS, {
    jobs,
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
