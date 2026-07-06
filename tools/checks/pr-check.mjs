#!/usr/bin/env node
/**
 * pr:check — runs the full per-PR gate (CI mirror, incl. e2e) in parallel.
 * Each task is an independent `pnpm <script>`; output is buffered per task and
 * a pass/fail summary is printed at the end. Exit ≠ 0 if any task fails.
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

// Per-PR gate — mirrors ci.yml lint+unit jobs. Playwright lanes are NOT here:
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
  // Generated compat matrices must match their generator inventory — a
  // hand-edited docs/public/compat file silently reverts on the next
  // `compat:generate` (PR #115 finding #1). Regeneration is idempotent, so
  // running it inside the gate only mutates the tree when there IS drift.
  'check:compat-drift',
  'check:source-grep',
  'backlog:check',
  'refs:check',
  'test:run',
  'test:parity',
].map((name) => ({ name, command: 'pnpm', args: ['run', name] }));

async function main() {
  const jobs = availableParallelism();
  console.log(`pr:check — ${TASKS.length} checks, up to ${jobs} in parallel\n`);
  const { results, ok } = await runChecks(TASKS, {
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
