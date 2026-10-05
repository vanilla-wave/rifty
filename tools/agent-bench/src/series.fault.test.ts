import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { type Report, regenerate, writeReport } from './report.ts';

const cli = resolve('tools/agent-bench/src/cli.ts');
const config = resolve('tools/agent-bench/configs/gpt-6-luna.json');
function invoke(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
}

it('resolves the full selected matrix deterministically without services or model calls', () => {
  const args = ['plan', '--config', config, '--task', 'node-endpoint', '--runs', '2'];
  const first = invoke(args);
  expect(first.status, first.stderr).toBe(0);
  const plan = JSON.parse(first.stdout);
  expect(plan.trials).toHaveLength(6);
  expect(
    plan.trials.filter((trial: { lane: string }) => trial.lane === 'rifty-no-coi'),
  ).toHaveLength(2);
  expect(plan.tasks[0]).toMatchObject({ id: 'node-endpoint', group: 'smoke', family: 'hono-api' });
  expect(plan.tasks[0].filesSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(plan.tasks[0].promptSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(invoke(args).stdout).toBe(first.stdout);
}, 60000);

it('rejects an occupied output before setup and preserves every old byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-series-collision-'));
  try {
    await writeFile(join(dir, 'report.json'), 'prior evidence');
    const result = invoke([
      'run',
      '--mock-model',
      '--task',
      'fix-date-sort',
      '--lane',
      'local-reference',
      '--output',
      dir,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/occupied|EEXIST/);
    expect(await readFile(join(dir, 'report.json'), 'utf8')).toBe('prior evidence');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

it('renders unfinished selected trials as missing, preserves completed records on regeneration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-series-partial-'));
  try {
    const settings = await loadConfig(config);
    const report = {
      header: {
        createdAt: 'test',
        sourceRevision: 'test',
        sourceDirty: false,
        versions: { node: 'test', piCli: 'test' },
        model: settings.endpoint!.id,
        profile: 'test',
        taskSet: 'test',
        endpoint: settings.endpoint!,
        limits: settings.limits,
        runsPerTask: 1,
        toolContextCaveat: '',
        unsupported: [],
        series: {
          status: 'interrupted',
          trials: [{ task: 'node-endpoint', lane: 'rifty-no-coi', runIndex: 1 }],
        },
      },
      runs: [],
    } as unknown as Report;
    await writeReport(dir, report);
    const before = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(before).toContain('interrupted');
    expect(before).toMatch(/node-endpoint.*rifty-no-coi.*1.*missing/);
    await regenerate(dir);
    expect(await readFile(join(dir, 'summary.md'), 'utf8')).toBe(before);
    expect(
      JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).header.series.trials,
    ).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('persistence permission/path failures throw instead of claiming retained evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-series-write-fail-'));
  try {
    await writeFile(join(dir, 'blocked'), 'occupied');
    await expect(writeReport(join(dir, 'blocked'), {} as Report)).rejects.toThrow();
    expect(await readFile(join(dir, 'blocked'), 'utf8')).toBe('occupied');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
