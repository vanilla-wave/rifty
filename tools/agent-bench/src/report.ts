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
import { assertComparablePlans, deriveStatistics, statisticsLines } from './statistics.ts';
export const caveat =
  'Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.';
export interface Run extends Omit<Observation, 'trace'> {
  task: string;
  lane: Lane;
  runIndex: number;
  profile: string;
  initialFilesSha256?: string;
  initialLockfileSha256?: string | null;
  attemptStartedAt?: string;
  agentStartedAt?: string;
  agentFinishedAt?: string;
  judgeStartedAt?: string;
  judgeFinishedAt?: string;
  completedAt?: string;
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
    purpose?: 'quality' | 'controls' | 'smoke' | 'diagnostic';
    control?: string;
    createdAt: string;
    sourceRevision: string;
    sourceDirty: boolean;
    versions: { node: string; piCli: string; chromium?: string; codexCli?: string };
    model: string;
    profile: string;
    taskSet: string;
    endpoint: Endpoint;
    limits: Config['limits'];
    noCoiPolicies?: Config['noCoiPolicies'];
    runsPerTask: number;
    toolContextCaveat: string;
    unsupported: string[];
    codex?: {
      model: string;
      reasoning: string;
      cliVersion?: string;
      sandbox: 'workspace-write';
      approval: 'automatic review';
      isolation: {
        ephemeral: boolean;
        ignoreUserConfig: boolean;
        ignoreRules: boolean;
        projectDocMaxBytes: number;
      };
      budgetAdmission: string;
    };
    plan?: Plan;
    series?: {
      status: 'running' | 'completed' | 'interrupted' | 'failed';
      trials: Trial[];
      active?: Trial;
      error?: string;
      finishedAt?: string;
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
      ...(report.header.codex === undefined
        ? {}
        : { codex: { ...report.header.codex, model: text(report.header.codex.model) } }),
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
  const statistics = deriveStatistics(report);
  if (persist) await writeJson(dir, 'report.json', report);
  if (report.header.plan || report.header.series)
    await writeJson(dir, 'statistics.json', statistics);
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
    `Known constraints: ${report.header.unsupported.join('; ')}.`,
    '',
    'Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).',
    'Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.',
    '',
  ];
  const cell = (value: string | null) => value?.replaceAll('|', '\\|').replaceAll('\n', ' ') ?? '—';
  if (report.header.codex)
    lines.push(
      `Native Codex reference: ${JSON.stringify(report.header.codex)}. Separate model/context; no Pi delta.`,
      'Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.',
    );
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
      `| ${run.task} | ${run.lane} | ${run.runIndex} | ${run.outcome} | ${run.agentStatus} | ${(run.elapsedMs / 1000).toFixed(1)} | ${run.toolCalls} | ${metric(run, 'inputTokens')} | ${metric(run, 'outputTokens')} | ${metric(run, 'retries')} | ${metric(run, 'compactions')} | ${metric(run, 'repeatedCallNotices')} | ${metric(run, 'editFailures')} | ${metric(run, 'malformedToolCalls')} | ${cell(run.failureClass)} | ${cell(run.note)} |`,
    );
  if (report.header.plan) {
    lines.push(
      '',
      'Frozen inputs (installed before-tree hashes per attempt below):',
      '',
      '| Case | Split/family | Input files | Lock | Prompt | Judge/support |',
      '|---|---|---|---|---|---|',
    );
    for (const task of report.header.plan.tasks)
      lines.push(
        `| ${task.id} | ${task.split ?? 'smoke'}/${task.family} | ${task.filesSha256} | ${task.lockfileSha256 ?? 'unavailable'} | ${task.promptSha256} | ${task.judgeSha256} |`,
      );
  }
  lines.push(
    '',
    'Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.',
    '',
    '| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |',
    '|---|---|---|---|---|',
  );
  const artifact = (path: string | undefined) =>
    path === undefined
      ? 'unavailable'
      : existsSync(join(dir, path))
        ? `[${cell(path)}](${path})`
        : existsSync(join(dir, 'source-artifacts.json.gz'))
          ? `[bundle](source-artifacts.json.gz): ${cell(path)}`
          : `${cell(path)} (not local)`;
  for (const run of report.runs)
    lines.push(
      `| ${run.task}/${run.lane}/${run.runIndex} | ${run.initialFilesSha256 ?? 'unobserved'}/${run.initialLockfileSha256 ?? 'unobserved'} | ${artifact(run.artifacts.trace)} | ${artifact(run.artifacts.before)} / ${artifact(run.artifacts.after)} | ${cell(JSON.stringify({ start: run.attemptStartedAt, agentStart: run.agentStartedAt, agentEnd: run.agentFinishedAt, judgeStart: run.judgeStartedAt, judgeEnd: run.judgeFinishedAt, complete: run.completedAt }))} |`,
    );
  lines.push(...statisticsLines(statistics));
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
function metric(run: Run, key: (typeof metricKeys)[number]): number | string {
  return run.unavailableMetrics?.includes(key) ? 'unknown' : (run[key] ?? '—');
}
type Summary = Record<(typeof metricKeys)[number], number | null> &
  Record<
    'runs' | 'passes' | 'budgetExceeded' | 'contextExceeded' | 'medianSeconds' | 'medianTools',
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
      metricKeys.map((key) => [
        key,
        runs.some((run) => run.unavailableMetrics?.includes(key))
          ? null
          : runs.reduce((sum, run) => sum + run[key], 0),
      ]),
    ) as Record<(typeof metricKeys)[number], number | null>),
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
      !['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'].includes(run.lane) ||
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
  assertComparablePlans(before, after);
  for (const key of [
    'endpoint',
    'purpose',
    'control',
    'codex',
    'limits',
    'noCoiPolicies',
    'taskSet',
    'runsPerTask',
  ] as const)
    if (
      !isDeepStrictEqual(
        key === 'purpose' ? (before.header.purpose ?? 'quality') : before.header[key],
        key === 'purpose' ? (after.header.purpose ?? 'quality') : after.header[key],
      )
    )
      throw new Error(`Incompatible comparison configuration: ${key}`);
  const previous = comparisonGroups(before);
  const current = comparisonGroups(after);
  if (!isDeepStrictEqual(previous.identities, current.identities))
    throw new Error('Incompatible comparison identities');
  const rows = [...previous.groups].map(([key, runs]) => {
    const old = summarize(runs);
    const next = summarize(current.groups.get(key)!);
    const delta = Object.fromEntries(
      (Object.keys(old) as (keyof Summary)[]).map((key) => [
        key,
        next[key] === null || old[key] === null ? null : next[key] - old[key],
      ]),
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
      lines.push(
        `| ${key} | ${row.before[key] ?? 'unknown'} | ${row.after[key] ?? 'unknown'} | ${row.delta[key] ?? 'unknown'} |`,
      );
    lines.push('');
  }
  await writeJson(current, 'comparison.json', comparison);
  await writeFile(join(current, 'comparison.md'), `${lines.join('\n')}\n`);
  return comparison;
}
