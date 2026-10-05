import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { emptyMetrics } from './metrics.ts';
import type { Plan } from './plan.ts';
import type { Report, Run } from './report.ts';
// Synthetic external JSON fixtures exercise arithmetic; never measured agent quality.
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
const tasks = [
  { id: 'stat-bug', group: 'bug', family: 'real-project', split: 'evaluation' },
  { id: 'stat-app', group: 'app', family: 'starter-app', split: 'evaluation' },
  { id: 'stat-cal', group: 'feature', family: 'ms', split: 'calibration' },
  { id: 'stat-smoke', group: 'smoke', family: 'legacy', split: 'smoke' },
];
function fixture(repeats = 3): Report {
  const trials = tasks.flatMap((task) =>
    lanes.flatMap((lane) =>
      Array.from({ length: repeats }, (_, index) => ({ task: task.id, lane, runIndex: index + 1 })),
    ),
  );
  const config = {
    limits: { maxToolCalls: 100, runTimeoutMs: 600000 },
    runsPerTask: repeats,
    playgroundPort: 5397,
  };
  const plan: Plan = {
    version: 1,
    sourceRevision: 'synthetic-arithmetic',
    sourceDirty: false,
    sourceDiffSha256: 'a'.repeat(64),
    config,
    order: 'task-lane-trial',
    tasks: tasks.map((task) => ({
      ...task,
      filesSha256: 'b'.repeat(64),
      lockfileSha256: 'c'.repeat(64),
      promptSha256: 'd'.repeat(64),
      judgeSha256: 'e'.repeat(64),
    })),
    trials,
  };
  return {
    header: {
      createdAt: 'synthetic-arithmetic',
      sourceRevision: 'synthetic-arithmetic',
      sourceDirty: false,
      versions: { node: 'fixture', piCli: 'fixture' },
      model: 'fixture-model',
      profile: 'fixture',
      taskSet: 'synthetic-arithmetic',
      endpoint: {
        id: 'fixture-model',
        name: 'fixture-model',
        provider: 'fixture',
        api: 'openai-completions',
        baseUrl: 'http://fixture.invalid',
        contextWindow: 100000,
        maxTokens: 8192,
        input: ['text'],
        reasoning: false,
        thinking: 'off',
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      limits: config.limits,
      runsPerTask: repeats,
      toolContextCaveat: 'Synthetic arithmetic; no real agents.',
      unsupported: [],
      purpose: 'quality',
      plan,
      series: { status: 'completed', trials },
    },
    runs: trials.map((trial) => {
      const pass = trial.lane === 'local-reference' || trial.lane === 'native-codex';
      return {
        ...emptyMetrics(),
        ...trial,
        profile: 'fixture',
        agentStatus: 'done',
        outcome: pass ? 'pass' : 'fail',
        elapsedMs: 1000,
        turns: 1,
        toolCalls: 1,
        usage: null,
        terminalTail: '',
        judge: { pass, probes: [] },
        finalDiff: [],
        artifacts: { trace: 'fixture.json' },
        failureClass: null,
        note: null,
      } as Run;
    }),
  };
}
async function generate(report: Report) {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-statistics-red-'));
  const original = JSON.stringify(report, null, 2);
  await writeFile(join(dir, 'report.json'), original);
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('tools/agent-bench/src/cli.ts'), 'report', dir],
    { encoding: 'utf8', timeout: 30000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(join(dir, 'report.json'), 'utf8')).toBe(original);
  return {
    dir,
    statistics: JSON.parse(await readFile(join(dir, 'statistics.json'), 'utf8')),
    summary: await readFile(join(dir, 'summary.md'), 'utf8'),
  };
}
it('reports fixed matrix uncertainty, separate groups/Codex and honest selected/missing accounting', async () => {
  const report = fixture();
  const { statistics, summary } = await generate(report);
  expect(statistics.selectedTrials).toBe(48);
  expect(statistics.retainedTrials).toBe(48);
  const native = statistics.cells.find(
    (row: { task: string; lane: string }) =>
      row.task === 'stat-bug' && row.lane === 'local-reference',
  );
  expect(native.passRate).toBe(1);
  expect(native.interval.lower).toBeCloseTo(0.025 ** (1 / 3), 12);
  expect(native.interval.upper).toBe(1);
  const failed = statistics.cells.find(
    (row: { task: string; lane: string }) => row.task === 'stat-bug' && row.lane === 'rifty',
  );
  expect(failed.passRate).toBe(0);
  expect(failed.interval.upper).toBeCloseTo(1 - 0.025 ** (1 / 3), 12);
  expect(
    statistics.groups.some(
      (row: { split: string; group: string }) =>
        row.split === 'evaluation' && row.group === 'project-change',
    ),
  ).toBe(true);
  expect(statistics.groups.some((row: { split: string }) => row.split === 'calibration')).toBe(
    true,
  );
  expect(statistics.groups.some((row: { split: string }) => row.split === 'smoke')).toBe(true);
  expect(
    statistics.cells
      .filter((row: { lane: string; piDelta: unknown }) => row.lane === 'native-codex')
      .every((row: { piDelta: unknown }) => row.piDelta === null),
  ).toBe(true);
  expect(summary).toMatch(/Clopper|binomial/);
  expect(summary).toMatch(/iid|independent/);
  expect(summary).toMatch(/equality|equivalence/);
  const before = await readFile(join((await generate(report)).dir, 'statistics.json'), 'utf8');
  expect(JSON.stringify(statistics, null, 2)).toBe(before.trim());
  const partial = fixture();
  partial.runs.pop();
  partial.header.series!.status = 'interrupted';
  const incomplete = (await generate(partial)).statistics;
  expect(incomplete.missingTrials).toBe(1);
  expect(
    incomplete.cells.find(
      (row: { task: string; lane: string }) =>
        row.task === 'stat-smoke' && row.lane === 'native-codex',
    ).passRate,
  ).toBeNull();
}, 60000);
it('does not present non-model reference controls as coding quality', async () => {
  const report = fixture();
  report.header.purpose = 'controls';
  report.header.control = 'reference';
  for (const row of report.runs) row.agentStatus = 'not-run';
  const { statistics } = await generate(report);
  expect(statistics.qualityEstimateAvailable).toBe(false);
}, 60000);

it('matches independent Decimal60 binomial oracle on a non-boundary20/4 cell', async () => {
  const report = fixture(20);
  for (const row of report.runs.filter(
    (row) => row.task === 'stat-bug' && row.lane === 'local-reference',
  )) {
    row.outcome = row.runIndex <= 4 ? 'pass' : 'fail';
    row.judge.pass = row.outcome === 'pass';
  }
  const { statistics } = await generate(report);
  const cell = statistics.cells.find(
    (row: { task: string; lane: string }) =>
      row.task === 'stat-bug' && row.lane === 'local-reference',
  );
  expect(cell.passRate).toBe(0.2);
  expect(cell.interval.lower).toBeCloseTo(0.05733399705003276, 12);
  expect(cell.interval.upper).toBeCloseTo(0.43661400299666836, 12);
}, 60000);
it('keeps unknown native telemetry unknown in derived totals', async () => {
  const report = fixture();
  report.runs.find((row) => row.lane === 'native-codex')!.unavailableMetrics = ['inputTokens'];
  const { statistics } = await generate(report);
  expect(
    statistics.cells.find(
      (row: { task: string; lane: string }) =>
        row.task === 'stat-bug' && row.lane === 'native-codex',
    ).inputTokens,
  ).toBeNull();
}, 60000);
it.each(['duplicate', 'outside'])(
  'rejects %s attempt identities rather than changing selected denominators',
  async (kind) => {
    const report = fixture();
    if (kind === 'duplicate') report.runs.push(structuredClone(report.runs[0]!));
    else report.runs[0]!.task = 'not-selected';
    const dir = await mkdtemp(join(tmpdir(), 'rifty-stat-invalid-'));
    const original = JSON.stringify(report);
    await writeFile(join(dir, 'report.json'), original);
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('tools/agent-bench/src/cli.ts'), 'report', dir],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(result.status).not.toBe(0);
    expect(await readFile(join(dir, 'report.json'), 'utf8')).toBe(original);
  },
  60000,
);

it.each(['filesSha256', 'lockfileSha256', 'promptSha256', 'judgeSha256', 'split'])(
  'rejects changed %s experiment identity with unchanged task names',
  async (key) => {
    const before = fixture();
    const after = structuredClone(before);
    Reflect.set(
      after.header.plan!.tasks[0]!,
      key,
      key === 'split' ? 'calibration' : 'f'.repeat(64),
    );
    const root = await mkdtemp(join(tmpdir(), 'rifty-stat-identity-'));
    const a = join(root, 'before');
    const b = join(root, 'after');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(a);
    await mkdir(b);
    await writeFile(join(a, 'report.json'), JSON.stringify(before));
    await writeFile(join(b, 'report.json'), JSON.stringify(after));
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('tools/agent-bench/src/cli.ts'), 'report', b, '--compare', a],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(result.status).not.toBe(0);
  },
  60000,
);
