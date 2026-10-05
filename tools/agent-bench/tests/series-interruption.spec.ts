import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Report } from '../src/report.ts';

async function series(
  output: string,
  runs: number,
  interruptAt?: 'START' | 'END',
  onStart?: () => Promise<void>,
) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tools/agent-bench/src/cli.ts'),
      'run',
      '--mock-model',
      '--lane',
      'local-reference',
      '--task',
      'fix-date-sort',
      '--runs',
      String(runs),
      '--output',
      output,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let interrupted = false;
  let fault: Promise<void> | undefined;
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk;
    if (onStart && !fault && stdout.includes('START fix-date-sort/')) fault = onStart();
    if (interruptAt && !interrupted && stdout.includes(`${interruptAt} fix-date-sort/`)) {
      interrupted = true;
      process.kill(child.pid!, 'SIGTERM');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  }, 180000);
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    await fault;
    return { code, stdout, stderr, interrupted };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null && child.pid)
      process.kill(-child.pid, 'SIGKILL');
  }
}

test('trace cleanup failure preserves the completed record and unstarted matrix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-series-cleanup-'));
  const output = join(root, 'series');
  try {
    const result = await series(output, 2, undefined, () =>
      mkdir(join(output, 'fix-date-sort/local-reference/1/browser.zip')).then(() => {}),
    );
    expect(result.code, result.stdout + result.stderr).not.toBe(0);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as Report;
    expect(report.header.series!.status).toBe('failed');
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]!.agentStatus).toBe('done');
    expect(report.runs[0]!.artifacts.trace).toContain('local-reference/1/trace.json');
    expect(await readFile(join(output, 'summary.md'), 'utf8')).toMatch(
      /local-reference.*2.*missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real native series retains pre-setup and completed interruption evidence, then starts fresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-series-acceptance-'));
  try {
    const setupDir = join(root, 'setup-interrupted');
    const setup = await series(setupDir, 2, 'START');
    expect(setup.interrupted, setup.stdout + setup.stderr).toBe(true);
    const partial = await readFile(join(setupDir, 'summary.md'), 'utf8');
    expect(partial).toContain('missing');
    const completedDir = join(root, 'completed-interrupted');
    const completed = await series(completedDir, 2, 'END');
    expect(completed.interrupted, completed.stdout + completed.stderr).toBe(true);
    const report = JSON.parse(await readFile(join(completedDir, 'report.json'), 'utf8')) as Report;
    expect(report.runs.length).toBeGreaterThanOrEqual(1);
    expect(report.runs[0]!.agentStatus).toBe('done');
    expect(report.runs[0]!.outcome).toBe('fail');
    expect(report.header.series!.trials).toHaveLength(2);
    const saved = await readFile(join(completedDir, 'summary.md'), 'utf8');
    expect(saved).toContain('missing');
    const regenerated = spawn(process.execPath, [
      '--import',
      'tsx',
      resolve('tools/agent-bench/src/cli.ts'),
      'report',
      completedDir,
    ]);
    expect(await new Promise<number | null>((done) => regenerated.once('close', done))).toBe(0);
    expect(await readFile(join(completedDir, 'summary.md'), 'utf8')).toBe(saved);
    const freshDir = join(root, 'fresh');
    const fresh = await series(freshDir, 1);
    expect(fresh.code, fresh.stdout + fresh.stderr).toBe(0);
    const next = JSON.parse(await readFile(join(freshDir, 'report.json'), 'utf8')) as Report;
    expect(next.header.series!.status).toBe('completed');
    expect(next.runs).toHaveLength(1);
    expect(next.runs[0]!.artifacts.workspace).not.toBe(report.runs[0]!.artifacts.workspace);
    expect(await readFile(join(completedDir, 'summary.md'), 'utf8')).toBe(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('selected unsupported no-COI Node trial remains a retained failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-series-unsupported-'));
  const output = join(root, 'series');
  try {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('tools/agent-bench/src/cli.ts'),
        'run',
        '--mock-model',
        '--lane',
        'rifty-no-coi',
        '--task',
        'node-endpoint',
        '--runs',
        '1',
        '--output',
        output,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    child.stdout.on('data', (chunk: Buffer) => {
      log += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      log += chunk;
    });
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    expect(code, log).toBe(0);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as Report;
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      task: 'node-endpoint',
      lane: 'rifty-no-coi',
      outcome: 'fail',
      stage: 'setup',
      agentStatus: 'error',
    });
    expect(report.runs[0]!.error).toContain('unsupported');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
