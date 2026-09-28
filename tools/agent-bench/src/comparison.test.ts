import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import * as reportApi from './report.ts';
import { type Report, readJson } from './report.ts';

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
  before: Report['header'];
  after: Report['header'];
  artifacts?: { baseline: string; current: string };
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
  original = await readJson<Report>(
    fileURLToPath(new URL('../reports/summaries/2026-09-27-gpt-6-luna-baseline/', import.meta.url)),
    'report.json',
  );
});
const cli = resolve('tools/agent-bench/src/cli.ts');
const run = promisify(execFile);
const cliReport = (current: string, baseline: string) =>
  run(process.execPath, ['--import', 'tsx', cli, 'report', current, '--compare', baseline], {
    cwd: resolve('.'),
  }).then(
    () => 0,
    (error) => error.code as number,
  );
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

it('preserves nonzero context/edit counters and both provenance headers', () => {
  const before = clone();
  const after = clone();
  after.header.sourceRevision = 'new-revision';
  after.header.profile = 'new-profile';
  for (const row of after.runs) row.profile = after.header.profile;
  group(before)[0]!.editFailures = 2;
  group(after)[0]!.editFailures = 7;
  for (const report of [before, after]) {
    const row = group(report)[0]!;
    row.outcome = 'context-exceeded';
    row.contextExceeded = true;
    row.agentStatus = 'error';
    row.judge.pass = false;
  }
  const second = group(after)[1]!;
  second.outcome = 'context-exceeded';
  second.contextExceeded = true;
  second.agentStatus = 'error';
  second.judge.pass = false;
  const result = compare(before, after);
  const row = result.rows.find((row) => row.task === 'fix-date-sort' && row.lane === 'rifty')!;
  expect(row.before).toMatchObject({ contextExceeded: 1, editFailures: 2 });
  expect(row.after).toMatchObject({ contextExceeded: 2, editFailures: 7 });
  expect(row.delta).toMatchObject({ contextExceeded: 1, editFailures: 5 });
  expect(result.before).toEqual(before.header);
  expect(result.after).toEqual(after.header);
});

it.each([
  'endpoint',
  'limits',
  'taskSet',
  'runsPerTask',
  'missing',
  'duplicate',
  'unmatched-index',
  'unmatched-task',
  'incomplete-both',
  'invalid-metric',
] as const)('[fault: corrupt-input] refuses incompatible comparison: %s', (kind) => {
  const before = clone();
  const after = clone();
  if (kind === 'endpoint') after.header.endpoint = { ...after.header.endpoint, maxTokens: 1234 };
  if (kind === 'limits') after.header.limits = { ...after.header.limits, maxToolCalls: 1 };
  if (kind === 'taskSet') after.header.taskSet = 'changed-tasks';
  if (kind === 'runsPerTask') after.header.runsPerTask = 2;
  if (kind === 'unmatched-index') after.runs[0]!.runIndex = 4;
  if (kind === 'unmatched-task') {
    for (const row of group(after)) row.task = 'different-task';
  }
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
  // Committed-summary baseline (gzip) against a fresh plain run directory.
  const baselineGz = gzipSync(`${JSON.stringify(original, null, 2)}\n`);
  await writeFile(join(baseline, 'report.json.gz'), baselineGz);
  const candidate = clone();
  candidate.header.sourceRevision = 'current-revision';
  candidate.header.profile = 'current-profile';
  for (const row of candidate.runs) row.profile = candidate.header.profile;
  await writeFile(join(current, 'report.json'), JSON.stringify(candidate));
  try {
    expect(await cliReport(current, baseline)).toBe(0);
    const json = JSON.parse(await readFile(join(current, 'comparison.json'), 'utf8')) as Comparison;
    expect(json.rows).toHaveLength(14);
    expect(json.regressions).toEqual([]);
    expect(json.before).toEqual(original.header);
    expect(json.after).toEqual(candidate.header);
    expect(json.artifacts).toEqual({ baseline, current });
    for (const name of ['comparison.json.gz', 'report.json.gz'])
      expect(existsSync(join(current, name))).toBe(false);
    const firstMarkdown = await readFile(join(current, 'comparison.md'), 'utf8');
    for (const value of [
      original.header.sourceRevision,
      original.header.profile,
      candidate.header.sourceRevision,
      candidate.header.profile,
      baseline,
      current,
      JSON.stringify(original.header.endpoint),
      JSON.stringify(original.header.limits),
    ]) {
      expect(firstMarkdown).toContain(value);
    }
    expect((await readFile(join(baseline, 'report.json.gz'))).equals(baselineGz)).toBe(true);
    expect((await readdir(baseline)).sort()).toEqual(['report.json.gz']);
    expect(await readFile(join(current, 'summary.md'), 'utf8')).toContain('GPT-6');
    const changed = clone();
    const lost = group(changed)[0]!;
    lost.outcome = 'fail';
    lost.judge.pass = false;
    await writeFile(join(current, 'report.json'), JSON.stringify(changed));
    expect(await cliReport(current, baseline)).toBe(1);
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

it('regenerates a gzip summary directory in its own format, byte-identical on repeat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-comparison-gz-'));
  const baseline = join(dir, 'baseline');
  const current = join(dir, 'current');
  await mkdir(baseline);
  await mkdir(current);
  await writeFile(join(baseline, 'report.json'), JSON.stringify(original));
  const candidate = clone();
  candidate.header.sourceRevision = 'current-revision';
  const reportGz = gzipSync(`${JSON.stringify(candidate, null, 2)}\n`);
  await writeFile(join(current, 'report.json.gz'), reportGz);
  try {
    expect(await cliReport(current, baseline)).toBe(0);
    const comparisonGz = await readFile(join(current, 'comparison.json.gz'));
    const json = JSON.parse(gunzipSync(comparisonGz).toString('utf8')) as Comparison;
    expect(json.rows).toHaveLength(14);
    expect(json.after).toEqual(candidate.header);
    expect(json.artifacts).toEqual({ baseline, current });
    expect((await readdir(current)).sort()).toEqual([
      'comparison.json.gz',
      'comparison.md',
      'report.json.gz',
      'summary.md',
    ]);
    expect((await readFile(join(current, 'report.json.gz'))).equals(reportGz)).toBe(true);
    expect(await readFile(join(current, 'summary.md'), 'utf8')).toContain('GPT-6');
    expect(await readFile(join(current, 'comparison.md'), 'utf8')).toContain(current);
    expect(await cliReport(current, baseline)).toBe(0);
    expect((await readFile(join(current, 'comparison.json.gz'))).equals(comparisonGz)).toBe(true);
    expect((await readFile(join(current, 'report.json.gz'))).equals(reportGz)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

it('[fault: corrupt-input] refuses absent or truncated summary JSON, naming both forms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-comparison-missing-'));
  try {
    const missing = await readJson(dir, 'report.json').then(
      () => undefined,
      (error: Error) => error.message,
    );
    expect(missing).toContain(join(dir, 'report.json'));
    expect(missing).toContain(join(dir, 'report.json.gz'));
    const gz = gzipSync(JSON.stringify(original));
    await writeFile(join(dir, 'report.json.gz'), gz.subarray(0, gz.length / 2));
    await expect(readJson(dir, 'report.json')).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
