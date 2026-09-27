import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, expect, it } from 'vitest';
import * as reportApi from './report.ts';
import type { Report } from './report.ts';

interface Summary {
  runs: number;
  passes: number;
  budgetExceeded: number;
  contextExceeded: number;
  medianSeconds: number;
  medianTools: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  compactions: number;
  repeatedCallNotices: number;
  editFailures: number;
  malformedToolCalls: number;
}
interface Comparison {
  rows: {
    task: string;
    lane: string;
    before: Summary;
    after: Summary;
    delta: Summary;
    noise: boolean;
    regression: boolean;
  }[];
  regressions: { task: string; lane: string }[];
}
let original: Report;
beforeAll(async () => {
  original = JSON.parse(
    await readFile(
      new URL('../reports/summaries/2026-09-27-gpt-6-luna-baseline/report.json', import.meta.url),
      'utf8',
    ),
  ) as Report;
});
const clone = () => structuredClone(original);
function compare(before: Report, after: Report): Comparison {
  const fn = (
    reportApi as unknown as { compareReports?: (before: Report, after: Report) => Comparison }
  ).compareReports;
  expect(fn).toBeTypeOf('function');
  return fn!(before, after);
}
function group(report: Report) {
  return report.runs
    .filter((run) => run.task === 'fix-date-sort' && run.lane === 'rifty')
    .sort((a, b) => a.runIndex - b.runIndex);
}

it('compares recorded identities and exact metrics; one negative pass remains a regression despite noise', () => {
  const before = clone();
  const after = clone();
  after.header.profile = 'synthetic-new-profile';
  after.header.sourceRevision = 'synthetic-current';
  for (const row of after.runs) row.profile = after.header.profile;
  for (const [index, row] of group(before).entries()) {
    row.elapsedMs = [1000, 3000, 2000][index]!;
    row.toolCalls = [1, 9, 2][index]!;
    row.inputTokens = [10, 20, 30][index]!;
    row.outputTokens = index + 1;
  }
  for (const [index, row] of group(after).entries()) {
    row.elapsedMs = [2000, 8000, 4000][index]!;
    row.toolCalls = [3, 9, 4][index]!;
    row.inputTokens = [11, 22, 33][index]!;
    row.outputTokens = index + 2;
    row.profile = after.header.profile;
  }
  const lost = group(after)[0]!;
  lost.outcome = 'budget-exceeded';
  lost.agentStatus = 'budget-exceeded';
  lost.judge.pass = false;
  lost.retries = 2;
  lost.compactions = 1;
  lost.repeatedCallNotices = 1;
  lost.editFailures = 4;
  lost.malformedToolCalls = 1;
  // Improvement elsewhere must not erase this task/lane loss.
  const recovered = after.runs.find((run) => run.outcome === 'fail')!;
  recovered.outcome = 'pass';
  recovered.judge.pass = true;
  const result = compare(before, after);
  const row = result.rows.find((row) => row.task === 'fix-date-sort' && row.lane === 'rifty')!;
  expect(row.before).toMatchObject({
    runs: 3,
    passes: 3,
    budgetExceeded: 0,
    medianSeconds: 2,
    medianTools: 2,
    inputTokens: 60,
    outputTokens: 6,
  });
  expect(row.after).toMatchObject({
    runs: 3,
    passes: 2,
    budgetExceeded: 1,
    medianSeconds: 4,
    medianTools: 4,
    inputTokens: 66,
    outputTokens: 9,
  });
  expect(row.delta).toMatchObject({
    passes: -1,
    budgetExceeded: 1,
    medianSeconds: 2,
    medianTools: 2,
    inputTokens: 6,
    outputTokens: 3,
    retries: 2,
    compactions: 1,
    repeatedCallNotices: 1,
    malformedToolCalls: 1,
  });
  expect(row).toMatchObject({ noise: true, regression: true });
  expect(result.regressions).toContainEqual({ task: 'fix-date-sort', lane: 'rifty' });
});

it.each([
  'endpoint',
  'limits',
  'taskSet',
  'runsPerTask',
  'missing',
  'duplicate',
  'incomplete-both',
  'invalid-metric',
] as const)('[fault: corrupt-input] refuses incompatible comparison: %s', (kind) => {
  const before = clone();
  const after = clone();
  if (kind === 'endpoint') after.header.endpoint = { ...after.header.endpoint, maxTokens: 1234 };
  if (kind === 'limits') after.header.limits = { ...after.header.limits, maxToolCalls: 1 };
  if (kind === 'taskSet') after.header.taskSet = 'changed-tasks';
  if (kind === 'runsPerTask') after.header.runsPerTask = 2;
  if (kind === 'missing') after.runs.pop();
  if (kind === 'duplicate') after.runs[1] = structuredClone(after.runs[0]!);
  if (kind === 'incomplete-both') {
    before.runs.pop();
    after.runs.pop();
  }
  if (kind === 'invalid-metric') after.runs[0]!.inputTokens = Number.NaN;
  expect(() => compare(before, after)).toThrow(
    /incompatible|missing|duplicate|incomplete|invalid|metric|configuration/i,
  );
});

it('keeps valid ordinary report regeneration and emits actual comparison artifacts through the CLI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-comparison-'));
  const baseline = join(dir, 'baseline');
  const current = join(dir, 'current');
  await mkdir(baseline);
  await mkdir(current);
  const originalJson = `${JSON.stringify(original, null, 2)}\n`;
  await writeFile(join(baseline, 'report.json'), originalJson);
  await writeFile(join(current, 'report.json'), originalJson);
  const cli = resolve('tools/agent-bench/src/cli.ts');
  const run = promisify(execFile);
  try {
    const first = await run(
      process.execPath,
      ['--import', 'tsx', cli, 'report', current, '--compare', baseline],
      { cwd: resolve('.') },
    ).then(
      () => ({ code: 0 }),
      (error) => ({ code: error.code as number }),
    );
    expect(first.code).toBe(0);
    const json = JSON.parse(await readFile(join(current, 'comparison.json'), 'utf8')) as Comparison;
    expect(json.rows).toHaveLength(14);
    expect(json.regressions).toEqual([]);
    expect(await readFile(join(baseline, 'report.json'), 'utf8')).toBe(originalJson);
    expect(await readFile(join(current, 'summary.md'), 'utf8')).toContain('GPT-6');
    const changed = clone();
    const lost = group(changed)[0]!;
    lost.outcome = 'fail';
    lost.judge.pass = false;
    await writeFile(join(current, 'report.json'), JSON.stringify(changed));
    const failed = await run(
      process.execPath,
      ['--import', 'tsx', cli, 'report', current, '--compare', baseline],
      { cwd: resolve('.') },
    ).then(
      () => ({ code: 0 }),
      (error) => ({ code: error.code as number }),
    );
    expect(failed.code).toBe(1);
    const markdown = await readFile(join(current, 'comparison.md'), 'utf8');
    expect(markdown).toMatch(/regression/i);
    expect(markdown).toMatch(/within noise/i);
    expect(
      (JSON.parse(await readFile(join(current, 'comparison.json'), 'utf8')) as Comparison)
        .regressions,
    ).toContainEqual({ task: 'fix-date-sort', lane: 'rifty' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
