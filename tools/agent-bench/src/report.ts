import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { type Config, type Endpoint, redact, redactJson } from './config.ts';
import type { diffTrees } from './files.ts';
import type { JudgeVerdict } from './judge/context.ts';
import type { Lane, Observation } from './lanes/types.ts';
import type { Plan, Trial } from './plan.ts';
export const caveat =
  'Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.';
export interface Run extends Omit<Observation, 'trace'> {
  task: string;
  lane: Lane;
  runIndex: number;
  profile: string;
  outcome: 'pass' | 'fail' | 'budget-exceeded' | 'context-exceeded';
  elapsedMs: number;
  judge: JudgeVerdict;
  finalDiff: ReturnType<typeof diffTrees>;
  artifacts: {
    trace: string;
    before?: string;
    after?: string;
    browserTrace?: string;
    workspace?: string;
    screen?: string;
  };
  failureClass: string | null;
  note: string | null;
  stage?: string;
  error?: string;
}
export interface Report {
  header: {
    createdAt: string;
    sourceRevision: string;
    sourceDirty: boolean;
    versions: { node: string; piCli: string; chromium?: string };
    model: string;
    profile: string;
    taskSet: string;
    endpoint: Endpoint;
    limits: Config['limits'];
    noCoiPolicies?: Config['noCoiPolicies'];
    runsPerTask: number;
    toolContextCaveat: string;
    unsupported: string[];
    plan?: Plan;
    series?: {
      status: 'running' | 'completed' | 'interrupted' | 'failed';
      trials: Trial[];
      active?: Trial;
      error?: string;
    };
  };
  runs: Run[];
}
/** Harness provenance and artifact addresses are not credential-derived payloads. */
export function privateReport(report: Report, secrets: readonly string[]): Report {
  const text = (value: string) => redact(value, secrets);
  return {
    header: {
      ...report.header,
      ...(report.header.plan === undefined
        ? {}
        : {
            plan: {
              ...report.header.plan,
              config: JSON.parse(redactJson(report.header.plan.config, secrets)) as Config,
            },
          }),
      ...(report.header.series === undefined
        ? {}
        : {
            series: {
              ...report.header.series,
              ...(report.header.series.error === undefined
                ? {}
                : { error: text(report.header.series.error) }),
            },
          }),
      model: text(report.header.model),
      endpoint: JSON.parse(redactJson(report.header.endpoint, secrets)) as Endpoint,
      ...(report.header.noCoiPolicies === undefined
        ? {}
        : {
            noCoiPolicies: JSON.parse(
              redactJson(report.header.noCoiPolicies, secrets),
            ) as Config['noCoiPolicies'],
          }),
    },
    runs: report.runs.map((run) => ({
      ...run,
      terminalTail: text(run.terminalTail),
      finalDiff: run.finalDiff.map((change) => ({
        path: text(change.path),
        before: change.before === null ? null : text(change.before),
        after: change.after === null ? null : text(change.after),
      })),
      judge: {
        pass: run.judge.pass,
        probes: run.judge.probes.map((probe) => ({
          ...probe,
          evidence:
            probe.evidence === undefined
              ? undefined
              : JSON.parse(redactJson(probe.evidence, secrets, undefined, 'payload')),
        })),
      },
      note: run.note === null ? null : text(run.note),
      ...(run.error === undefined ? {} : { error: text(run.error) }),
    })),
  };
}

/** Committed summaries keep JSON as deterministic gzip (`name.gz`); fresh run dirs plain. */
export async function readJson<T>(dir: string, name: string): Promise<T> {
  const path = join(dir, name);
  const absent = (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  };
  const text =
    (await readFile(path).catch(absent)) ?? (await readFile(`${path}.gz`).then(gunzipSync, absent));
  if (!text) throw new Error(`Missing ${path} or ${path}.gz`);
  return JSON.parse(text.toString('utf8')) as T;
}
/** Output format follows the directory: gzip only where `report.json.gz` alone exists. */
async function writeJson(dir: string, name: string, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const gzip = !existsSync(join(dir, 'report.json')) && existsSync(join(dir, 'report.json.gz'));
  if (!gzip) {
    await writeFile(join(dir, `${name}.tmp`), text);
    return rename(join(dir, `${name}.tmp`), join(dir, name));
  }
  const bytes = gzipSync(text);
  bytes[9] = 0x03; // RFC 1952 OS byte: zlib writes host OS (macOS 0x13); pin Unix. Deflate stream: per zlib build.
  await writeFile(join(dir, `${name}.gz.tmp`), bytes);
  await rename(join(dir, `${name}.gz.tmp`), join(dir, `${name}.gz`));
}
export async function writeReport(dir: string, report: Report, persist = true) {
  if (persist) await writeJson(dir, 'report.json', report);
  const lines = [
    `# Agent benchmark: ${report.header.model}`,
    '',
    `Profile: ${report.header.profile}; task set: ${report.header.taskSet}; runs/task: ${report.header.runsPerTask}.`,
    `Limits: ${JSON.stringify(report.header.limits)}.`,
    `no-COI policies: ${JSON.stringify(report.header.noCoiPolicies ?? {})}.`,
    `Catalog entry: ${JSON.stringify(report.header.endpoint)}.`,
    `Source: ${report.header.sourceRevision}${report.header.sourceDirty ? ' (working tree modified)' : ''}; versions: ${JSON.stringify(report.header.versions)}.`,
    '',
    report.header.toolContextCaveat,
    '',
    `Excluded: ${report.header.unsupported.join('; ')}.`,
    '',
    'Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).',
    'Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.',
    '',
  ];
  const cell = (value: string | null) => value?.replaceAll('|', '\\|').replaceAll('\n', ' ') ?? '—';
  if (report.header.series) {
    const series = report.header.series;
    lines.push(
      `Series: ${series.status}; selected ${series.trials.length}; retained ${report.runs.length}.`,
      'Incomplete series is partial evidence; missing work is never success.',
    );
    if (series.error) lines.push(`Series error: ${cell(series.error)}`);
  }
  lines.push(
    '',
    '| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |',
    '|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|',
  );
  if (report.header.series) {
    const series = report.header.series;
    for (const trial of series.trials) {
      if (
        report.runs.some(
          (run) =>
            run.task === trial.task && run.lane === trial.lane && run.runIndex === trial.runIndex,
        )
      )
        continue;
      lines.push(
        `| ${trial.task} | ${trial.lane} | ${trial.runIndex} | missing | ${series.active?.task === trial.task && series.active.lane === trial.lane && series.active.runIndex === trial.runIndex ? 'unfinished' : 'not started'} |`,
      );
    }
  }
  for (const run of report.runs)
    lines.push(
      `| ${run.task} | ${run.lane} | ${run.runIndex} | ${run.outcome} | ${run.agentStatus} | ${(run.elapsedMs / 1000).toFixed(1)} | ${run.toolCalls} | ${run.inputTokens ?? '—'} | ${run.outputTokens ?? '—'} | ${run.retries ?? '—'} | ${run.compactions ?? '—'} | ${run.repeatedCallNotices ?? '—'} | ${run.editFailures ?? '—'} | ${run.malformedToolCalls ?? '—'} | ${cell(run.failureClass)} | ${cell(run.note)} |`,
    );
  lines.push(
    '',
    'Per-task pass-rate delta versus local-reference (budget/context counts remain visible):',
    '',
    '| Task | Lane | Pass / runs | Budget | Context | Delta |',
    '|---|---|---:|---:|---:|---:|',
  );
  for (const task of [...new Set(report.runs.map((run) => run.task))]) {
    const native = report.runs.filter((run) => run.task === task && run.lane === 'local-reference');
    const reference = native.length
      ? native.filter((run) => run.outcome === 'pass').length / native.length
      : null;
    for (const lane of ['rifty', 'rifty-no-coi', 'local-reference']) {
      const rows = report.runs.filter((run) => run.task === task && run.lane === lane);
      if (!rows.length) continue;
      const pass = rows.filter((run) => run.outcome === 'pass').length;
      lines.push(
        `| ${task} | ${lane} | ${pass}/${rows.length} | ${rows.filter((run) => run.outcome === 'budget-exceeded').length} | ${rows.filter((run) => run.outcome === 'context-exceeded').length} | ${reference === null ? 'unavailable' : (pass / rows.length - reference).toFixed(3)} |`,
      );
    }
  }
  await writeFile(join(dir, 'summary.md'), `${lines.join('\n')}\n`);
}
export async function regenerate(dir: string) {
  await writeReport(dir, await readJson<Report>(dir, 'report.json'), false);
}

const metricKeys = [
  'inputTokens',
  'outputTokens',
  'retries',
  'compactions',
  'repeatedCallNotices',
  'editFailures',
  'malformedToolCalls',
] as const;
type Summary = Record<
  | (typeof metricKeys)[number]
  | 'runs'
  | 'passes'
  | 'budgetExceeded'
  | 'contextExceeded'
  | 'medianSeconds'
  | 'medianTools',
  number
>;
function summarize(runs: Run[]): Summary {
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  };
  return {
    runs: runs.length,
    passes: runs.filter((run) => run.outcome === 'pass').length,
    budgetExceeded: runs.filter((run) => run.outcome === 'budget-exceeded').length,
    contextExceeded: runs.filter((run) => run.outcome === 'context-exceeded').length,
    medianSeconds: median(runs.map((run) => run.elapsedMs / 1000)),
    medianTools: median(runs.map((run) => run.toolCalls)),
    ...(Object.fromEntries(
      metricKeys.map((key) => [key, runs.reduce((sum, run) => sum + run[key], 0)]),
    ) as Record<(typeof metricKeys)[number], number>),
  };
}
function comparisonGroups(report: Report) {
  if (
    !Number.isInteger(report.header.runsPerTask) ||
    report.header.runsPerTask < 1 ||
    !report.runs.length
  )
    throw new Error('Invalid comparison run count');
  const identities = new Set<string>();
  const groups = new Map<string, Run[]>();
  for (const run of report.runs) {
    if (
      !run.task ||
      !['rifty', 'rifty-no-coi', 'local-reference'].includes(run.lane) ||
      !Number.isInteger(run.runIndex) ||
      run.runIndex < 1 ||
      run.runIndex > report.header.runsPerTask
    )
      throw new Error('Invalid comparison identity');
    const identity = JSON.stringify([run.task, run.lane, run.runIndex]);
    if (identities.has(identity)) throw new Error(`Duplicate comparison identity: ${identity}`);
    identities.add(identity);
    for (const key of [...metricKeys, 'elapsedMs', 'toolCalls'] as const)
      if (!Number.isFinite(run[key]) || run[key] < 0)
        throw new Error(`Invalid metric ${key}: ${identity}`);
    if (!['pass', 'fail', 'budget-exceeded', 'context-exceeded'].includes(run.outcome))
      throw new Error(`Invalid outcome: ${identity}`);
    const key = JSON.stringify([run.task, run.lane]);
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  for (const [key, rows] of groups)
    if (rows.length !== report.header.runsPerTask)
      throw new Error(`Incomplete comparison group: ${key}`);
  return { groups, identities };
}
export function compareReports(before: Report, after: Report) {
  for (const key of ['endpoint', 'limits', 'noCoiPolicies', 'taskSet', 'runsPerTask'] as const)
    if (!isDeepStrictEqual(before.header[key], after.header[key]))
      throw new Error(`Incompatible comparison configuration: ${key}`);
  const previous = comparisonGroups(before);
  const current = comparisonGroups(after);
  if (!isDeepStrictEqual(previous.identities, current.identities))
    throw new Error('Incompatible comparison identities');
  const rows = [...previous.groups].map(([key, runs]) => {
    const old = summarize(runs);
    const next = summarize(current.groups.get(key)!);
    const delta = Object.fromEntries(
      (Object.keys(old) as (keyof Summary)[]).map((key) => [key, next[key] - old[key]]),
    ) as Summary;
    return {
      task: runs[0]!.task,
      lane: runs[0]!.lane,
      before: old,
      after: next,
      delta,
      noise: old.runs === 3 && Math.abs(delta.passes) === 1,
      regression: delta.passes < 0,
    };
  });
  return {
    before: before.header,
    after: after.header,
    rows,
    regressions: rows.filter((row) => row.regression).map(({ task, lane }) => ({ task, lane })),
  };
}
export async function writeComparison(current: string, baseline: string) {
  const read = (dir: string) => readJson<Report>(dir, 'report.json');
  const comparison = {
    ...compareReports(await read(baseline), await read(current)),
    artifacts: { baseline, current },
  };
  const lines = [
    '# Agent benchmark comparison',
    '',
    `Baseline artifacts: ${baseline}`,
    `Current artifacts: ${current}`,
    '',
    `Before: ${JSON.stringify(comparison.before)}`,
    `After: ${JSON.stringify(comparison.after)}`,
    '',
    'Delta = after − before. ±1 pass on 3 runs is within noise; negative remains a regression.',
    '',
  ];
  for (const row of comparison.rows) {
    lines.push(
      `## ${row.task} / ${row.lane}`,
      '',
      `${row.regression ? 'REGRESSION' : 'No regression'}${row.noise ? ' (within noise)' : ''}.`,
      '',
      '| Metric | Before | After | Delta |',
      '|---|---:|---:|---:|',
    );
    for (const key of Object.keys(row.before) as (keyof Summary)[])
      lines.push(`| ${key} | ${row.before[key]} | ${row.after[key]} | ${row.delta[key]} |`);
    lines.push('');
  }
  await writeJson(current, 'comparison.json', comparison);
  await writeFile(join(current, 'comparison.md'), `${lines.join('\n')}\n`);
  return comparison;
}
