import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Report } from '../src/report.ts';

async function series(output: string, runs: number, interruptAt?: 'START' | 'END') {
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
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk;
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
    return { code, stdout, stderr, interrupted };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null && child.pid)
      process.kill(-child.pid, 'SIGKILL');
  }
}

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
