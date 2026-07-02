/**
 * Diagnostic-first report (ADR-0191): per-run records with human fill-in
 * `failureClass`/`note` (null in v1 until a human classifies), per-task pass
 * rates + rifty vs local-reference delta. `budget-exceeded` is a DISTINCT
 * outcome, never conflated with fail (excluded from pass-rate denominators).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchLimits } from './config.ts';
import type { JudgeProbe } from './judge/context.ts';
import type { LaneId } from './lanes/types.ts';

export const FAILURE_CLASSES = [
  'agent',
  'rifty-runtime',
  'rifty-tooling',
  'ai-mode-ux',
  'provider',
  'task-bad',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface ReportHeader {
  readonly runId: string;
  readonly createdAt: string;
  readonly model: string;
  /** Lane id → prompt profile name (ADR-0190 named profiles). */
  readonly promptProfile: Record<string, string>;
  readonly taskSetVersion: string;
  /** Key VALUE never stored — only the env var name. */
  readonly endpoint: { readonly baseUrl: string; readonly envKey: string };
  readonly limits: BenchLimits;
  readonly runsPerTask: number;
  /** Lane id → version facts (pi version, node version, ...). */
  readonly laneVersions: Record<string, Record<string, string>>;
}

export interface RunRecord {
  readonly task: string;
  readonly lane: LaneId;
  readonly runIndex: number;
  /** null ONLY when judging was skipped (--dry-judge scaffolding). */
  readonly outcome: 'pass' | 'fail' | 'budget-exceeded' | null;
  readonly judgeSkipped: 'dry-judge' | null;
  readonly elapsedMs: number;
  readonly turns: number;
  readonly toolCalls: number;
  readonly terminalTail: string;
  readonly finalDiff: string;
  readonly previewProbes: JudgeProbe[];
  readonly trace: {
    readonly artifacts: Record<string, string>;
    readonly agentExitCode: number | null;
    readonly budgetReason: string | null;
  };
  /** Human fill-in after the run (v1: always written as null). */
  readonly failureClass: FailureClass | null;
  readonly note: string | null;
}

export interface LaneTaskStats {
  readonly runs: number;
  readonly pass: number;
  readonly fail: number;
  readonly budgetExceeded: number;
  readonly notJudged: number;
  /** pass / (pass + fail); null when nothing was judged. */
  readonly passRate: number | null;
}

export interface TaskSummary {
  readonly task: string;
  readonly perLane: Record<string, LaneTaskStats>;
  /** rifty passRate − local-reference passRate; null unless both lanes judged. */
  readonly delta: number | null;
}

export interface BenchReport {
  readonly header: ReportHeader;
  readonly runs: RunRecord[];
  readonly tasks: TaskSummary[];
}

function laneStats(records: RunRecord[]): LaneTaskStats {
  const pass = records.filter((r) => r.outcome === 'pass').length;
  const fail = records.filter((r) => r.outcome === 'fail').length;
  const budgetExceeded = records.filter((r) => r.outcome === 'budget-exceeded').length;
  const notJudged = records.filter((r) => r.outcome === null).length;
  const judged = pass + fail;
  return {
    runs: records.length,
    pass,
    fail,
    budgetExceeded,
    notJudged,
    passRate: judged === 0 ? null : pass / judged,
  };
}

export function aggregateTasks(records: RunRecord[]): TaskSummary[] {
  const byTask = new Map<string, RunRecord[]>();
  for (const record of records) {
    const list = byTask.get(record.task) ?? [];
    list.push(record);
    byTask.set(record.task, list);
  }
  return [...byTask.entries()].map(([task, taskRecords]) => {
    const lanes = new Set(taskRecords.map((r) => r.lane));
    const perLane: Record<string, LaneTaskStats> = {};
    for (const lane of lanes) {
      perLane[lane] = laneStats(taskRecords.filter((r) => r.lane === lane));
    }
    const rifty = perLane.rifty?.passRate ?? null;
    const local = perLane['local-reference']?.passRate ?? null;
    return {
      task,
      perLane,
      delta: rifty !== null && local !== null ? rifty - local : null,
    };
  });
}

export function buildReport(header: ReportHeader, runs: RunRecord[]): BenchReport {
  return { header, runs, tasks: aggregateTasks(runs) };
}

function pct(rate: number | null): string {
  return rate === null ? 'n/a' : `${Math.round(rate * 100)}%`;
}

export function renderSummaryMd(report: BenchReport): string {
  const h = report.header;
  const lines: string[] = [
    `# agent-bench ${h.runId}`,
    '',
    `- model: \`${h.model}\` @ \`${h.endpoint.baseUrl}\` (key env: \`${h.endpoint.envKey}\`)`,
    `- task set: ${h.taskSetVersion}; runs/task: ${h.runsPerTask}; created: ${h.createdAt}`,
    `- limits: maxToolCalls=${h.limits.maxToolCalls}, runTimeoutMs=${h.limits.runTimeoutMs}, toolTimeoutMs=${h.limits.toolTimeoutMs}`,
    `- prompt profiles: ${Object.entries(h.promptProfile)
      .map(([lane, p]) => `${lane}=${p}`)
      .join(', ')}`,
    `- lane versions: ${Object.entries(h.laneVersions)
      .map(
        ([lane, v]) =>
          `${lane}={${Object.entries(v)
            .map(([k, val]) => `${k}:${val}`)
            .join(', ')}}`,
      )
      .join('; ')}`,
    '',
    '## Per task',
    '',
    '| task | lane | pass | fail | budget-exceeded | not judged | pass rate | delta (rifty − local) |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const task of report.tasks) {
    for (const [lane, stats] of Object.entries(task.perLane)) {
      lines.push(
        `| ${task.task} | ${lane} | ${stats.pass} | ${stats.fail} | ${stats.budgetExceeded} | ${stats.notJudged} | ${pct(stats.passRate)} | ${task.delta === null ? 'n/a' : task.delta.toFixed(2)} |`,
      );
    }
  }
  lines.push('', '## Runs', '');
  lines.push(
    '| task | lane | run | outcome | elapsed | turns | tool calls | failureClass | note |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const run of report.runs) {
    const outcome = run.outcome ?? `not judged (${run.judgeSkipped})`;
    lines.push(
      `| ${run.task} | ${run.lane} | ${run.runIndex} | ${outcome} | ${(run.elapsedMs / 1000).toFixed(1)}s | ${run.turns} | ${run.toolCalls} | ${run.failureClass ?? '—'} | ${run.note ?? '—'} |`,
    );
  }
  const failing = report.runs.filter((r) => r.outcome === 'fail');
  if (failing.length > 0) {
    lines.push('', '## Failure evidence', '');
    for (const run of failing) {
      lines.push(`### ${run.task} / ${run.lane} / run ${run.runIndex}`, '');
      for (const probe of run.previewProbes) {
        lines.push(`- [${probe.pass ? 'pass' : 'FAIL'}] ${probe.name}: ${probe.evidence}`);
      }
      lines.push('');
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writeReport(dir: string, report: BenchReport): { reportPath: string } {
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'summary.md'), renderSummaryMd(report), 'utf8');
  return { reportPath };
}

/** `agent-bench report <dir>`: regenerate summary.md after human classification. */
export function regenerateSummary(dir: string): string {
  const reportPath = join(dir, 'report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as BenchReport;
  // Recompute aggregates so a human editing failureClass/note (or pruning runs)
  // never leaves stale per-task numbers behind.
  const rebuilt = buildReport(report.header, report.runs);
  const summaryPath = join(dir, 'summary.md');
  writeFileSync(summaryPath, renderSummaryMd(rebuilt), 'utf8');
  return summaryPath;
}
