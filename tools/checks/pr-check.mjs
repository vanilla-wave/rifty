#!/usr/bin/env node
/**
 * Local static/build/unit/parity PR gate. Browser lanes run separately.
 * Tasks run sequentially — test:run and test:parity each saturate every core;
 * scheduled concurrently they time-fail each other. Any failure fails the gate.
 *
 * Lanes follow the diff: a documentation-only working tree (vs the origin/main
 * merge-base, CI's own classifier) skips the source lanes and names them;
 * `--all` forces the full gate; no merge-base → full gate (fail-open).
 * A red test:run reruns its failed files once in isolation and labels the
 * outcome (how many were vitest time-outs, host load): the gate's own worker
 * pool is the main contention (2026-09-03: 34.9 s in the full run vs 5.8 s
 * isolated under the same host load). A failure that reproduces in isolation
 * stays red; a pass on rerun is reported as such, never hidden. No JSON
 * report (vitest aborted before its summary) → no rerun.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDocumentationOnlyPath } from './ci-change-scope.mjs';

/** @typedef {{ name: string, command: string, args?: string[] }} Task */
/** @typedef {{ name: string, code: number, output: string, durationMs: number, note?: string }} Result */

/** Lanes whose inputs are source, never docs. */
export const SOURCE_LANES = new Set([
  'typecheck',
  'build:libs',
  'check:arch',
  'test:run',
  'test:parity',
]);
export const TIMEOUT_RE = /Test timed out in \d+ms/u;

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
 * Run tasks one at a time in declaration order. A failed task may be replaced by
 * `retry(result)` — a second Result (e.g. an isolated rerun) or null to keep the failure.
 * @param {Task[]} tasks
 * @param {{ onResult?: (r: Result) => void, retry?: (r: Result) => Promise<Result | null> }} [opts]
 * @returns {Promise<{ results: Result[], ok: boolean }>}
 */
export async function runChecks(tasks, { onResult, retry } = {}) {
  /** @type {Result[]} */
  const results = [];
  for (const task of tasks) {
    let result = await runOne(task);
    if (result.code !== 0 && retry) result = (await retry(result)) ?? result;
    results.push(result);
    onResult?.(result);
  }
  return { results, ok: results.every((r) => r.code === 0) };
}

/** 'docs-only' when every changed path is documentation; 'full' otherwise or for an empty/unknown diff. */
export function classifyDiff(/** @type {string[] | null} */ paths) {
  return paths && paths.length > 0 && paths.every(isDocumentationOnlyPath) ? 'docs-only' : 'full';
}

/** @param {Task[]} tasks @param {'docs-only' | 'full'} diffClass */
export function selectTasks(tasks, diffClass) {
  return diffClass === 'docs-only' ? tasks.filter((t) => !SOURCE_LANES.has(t.name)) : tasks;
}

/** Changed paths of the working tree (tracked + untracked) vs the origin/main merge-base; null when unknown. */
export function workingTreePaths(cwd = process.cwd()) {
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    const base = git('merge-base', 'origin/main', 'HEAD').trim();
    const tracked = git('diff', '--name-only', '--no-renames', '-z', base, '--')
      .split('\0')
      .filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(Boolean);
    return [...new Set([...tracked, ...untracked])];
  } catch {
    return null;
  }
}

/**
 * Failed files of a vitest JSON report, each with the count of failed tests and how
 * many of them were vitest time-outs. Empty when the report is missing (aborted run).
 * @param {{ testResults?: { name: string, status: string, assertionResults?: { status: string, failureMessages?: string[] }[] }[] } | null | undefined} report
 * @returns {{ file: string, failed: number, timeouts: number }[]}
 */
export function failedFiles(report) {
  if (!report?.testResults) return [];
  const files = [];
  for (const tr of report.testResults) {
    if (tr.status !== 'failed') continue;
    const failed = (tr.assertionResults ?? []).filter((a) => a.status === 'failed');
    const timeouts = failed.filter((a) =>
      (a.failureMessages ?? []).some((m) => TIMEOUT_RE.test(m)),
    ).length;
    files.push({ file: tr.name, failed: failed.length, timeouts });
  }
  return files;
}

export function hostLoad() {
  return `load ${loadavg()
    .map((l) => l.toFixed(1))
    .join('/')} on ${cpus().length} cpus`;
}

// Playwright lanes are not here:
// they spin up browser workers + a vite dev server and, run alongside these,
// starve the timing-sensitive parity/stream checks. Run them separately:
// `pnpm test:e2e` and `pnpm test:browser-unit` (CI keeps its own e2e-chromium
// and browser-unit-chromium jobs). All tasks below are mutually independent.
/** @type {Task[]} */
export const TASKS = [
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
  'check:pass-binding', // merge-time REV-8 binding; skips draft PRs
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
  const cwd = process.cwd();
  const paths = workingTreePaths(cwd);
  const diffClass = process.argv.includes('--all') ? 'full' : classifyDiff(paths);
  const tasks = selectTasks(TASKS, diffClass);
  const reportPath = join(mkdtempSync(join(tmpdir(), 'rifty-pr-check-')), 'test-run.json');
  for (const t of tasks) {
    if (t.name === 'test:run')
      t.args = [
        ...(t.args ?? []),
        '--reporter=default',
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ];
  }
  const skipped = TASKS.filter((t) => !tasks.includes(t)).map((t) => t.name);
  console.log(`pr:check — ${tasks.length} checks, sequential; ${hostLoad()}`);
  if (diffClass === 'docs-only') {
    console.log(`  docs-only diff (${paths?.length ?? 0} paths): skipping ${skipped.join(', ')}`);
  } else if (paths === null) {
    console.log('  no origin/main merge-base: full gate');
  }
  console.log('');
  const { results, ok } = await runChecks(tasks, {
    onResult: (r) => {
      const mark = r.code === 0 ? '✓' : '✗';
      console.log(
        `  ${mark} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)${r.note ? ` — ${r.note}` : ''}`,
      );
    },
    retry: async (r) => {
      if (r.name !== 'test:run') return null;
      /** @type {ReturnType<typeof JSON.parse> | null} */
      let report = null;
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch {
        console.log('  … test:run: no JSON report — vitest aborted before its summary; no rerun');
        return null;
      }
      const failed = failedFiles(report);
      if (failed.length === 0) return null;
      const files = failed.map((f) =>
        f.file.startsWith(`${cwd}/`) ? f.file.slice(cwd.length + 1) : f.file,
      );
      const timeouts = failed.reduce((n, f) => n + f.timeouts, 0);
      const tests = failed.reduce((n, f) => n + f.failed, 0);
      const load = hostLoad();
      console.log(
        `  … test:run: ${files.length} file(s) failed (${tests} tests, ${timeouts} vitest time-outs; ${load}); isolated rerun: ${files.join(', ')}`,
      );
      const rerun = await runOne({
        name: 'test:run',
        command: 'pnpm',
        args: ['run', 'test:run', ...files],
      });
      if (rerun.code !== 0) {
        return {
          ...rerun,
          output: `${r.output}\n\n--- isolated rerun (still failing) ---\n${rerun.output}`,
        };
      }
      return {
        ...rerun,
        durationMs: r.durationMs + rerun.durationMs,
        note: `${files.length} file(s) passed on isolated rerun (${tests} failures, ${timeouts} vitest time-outs; ${load})`,
      };
    },
  });
  const failed = results.filter((r) => r.code !== 0);
  for (const r of failed) {
    console.log(`\n${'─'.repeat(60)}\n✗ ${r.name}\n${'─'.repeat(60)}\n${r.output.trimEnd()}`);
  }
  const scope =
    diffClass === 'docs-only'
      ? ` (docs-only: ${results.length}/${results.length}; skipped ${skipped.join(', ')})`
      : '';
  console.log(
    `\n${ok ? `✓ pr:check passed${scope}` : `✗ pr:check failed (${failed.length}/${results.length}): ${failed.map((r) => r.name).join(', ')}`}`,
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
