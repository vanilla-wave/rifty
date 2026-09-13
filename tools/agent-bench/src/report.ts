import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, Endpoint } from './config.ts';
import type { JudgeVerdict } from './judge/context.ts';
import type { Lane, Observation } from './lanes/types.ts';
export const caveat =
  'Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.';
export interface Run extends Omit<Observation, 'trace'> {
  task: string;
  lane: Lane;
  runIndex: number;
  profile: string;
  outcome: 'pass' | 'fail' | 'budget-exceeded';
  elapsedMs: number;
  judge: JudgeVerdict;
  finalDiff: unknown;
  artifacts: { trace: string; browserTrace?: string; workspace?: string; screen?: string };
  failureClass: string | null;
  note: string | null;
  stage?: string;
  error?: string;
}
export interface Report {
  header: {
    createdAt: string;
    model: string;
    profile: string;
    taskSet: string;
    endpoint: Endpoint;
    limits: Config['limits'];
    runsPerTask: number;
    toolContextCaveat: string;
    unsupported: string[];
  };
  runs: Run[];
}
export async function writeReport(dir: string, report: Report) {
  await writeFile(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# Agent benchmark: ${report.header.model}`,
    '',
    `Profile: ${report.header.profile}; task set: ${report.header.taskSet}; runs/task: ${report.header.runsPerTask}.`,
    `Limits: ${JSON.stringify(report.header.limits)}.`,
    '',
    report.header.toolContextCaveat,
    '',
    `Excluded: ${report.header.unsupported.join('; ')}.`,
    '',
    'Outcomes: pass, fail, budget-exceeded (separate; never counted as ordinary fail).',
    'Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.',
    '',
    '| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Class | Note |',
    '|---|---|---:|---|---|---:|---:|---|---|',
  ];
  const cell = (value: string | null) => value?.replaceAll('|', '\\|').replaceAll('\n', ' ') ?? '—';
  for (const run of report.runs)
    lines.push(
      `| ${run.task} | ${run.lane} | ${run.runIndex} | ${run.outcome} | ${run.agentStatus} | ${(run.elapsedMs / 1000).toFixed(1)} | ${run.toolCalls} | ${cell(run.failureClass)} | ${cell(run.note)} |`,
    );
  lines.push(
    '',
    'Per-task pass-rate delta versus local-reference (budget counts remain visible):',
    '',
    '| Task | Lane | Pass / runs | Budget | Delta |',
    '|---|---|---:|---:|---:|',
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
        `| ${task} | ${lane} | ${pass}/${rows.length} | ${rows.filter((run) => run.outcome === 'budget-exceeded').length} | ${reference === null ? 'unavailable' : (pass / rows.length - reference).toFixed(3)} |`,
      );
    }
  }
  await writeFile(join(dir, 'summary.md'), `${lines.join('\n')}\n`);
}
export async function regenerate(dir: string) {
  await writeReport(dir, JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as Report);
}
