import { isDeepStrictEqual } from 'node:util';
import type { Lane } from './lanes/types.ts';
import type { Plan, Trial } from './plan.ts';
import type { Report, Run } from './report.ts';
export interface Interval {
  lower: number;
  upper: number;
}
const allLanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const metricKeys = [
  'inputTokens',
  'outputTokens',
  'retries',
  'compactions',
  'repeatedCallNotices',
  'editFailures',
  'malformedToolCalls',
] as const;
function cdf(n: number, k: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n || p === 0) return 1;
  if (p === 1) return 0;
  let coefficient = 0;
  let sum = 0;
  for (let j = 0; j <= k; j++) {
    if (j) coefficient += Math.log(n - j + 1) - Math.log(j);
    sum += Math.exp(coefficient + j * Math.log(p) + (n - j) * Math.log1p(-p));
  }
  return Math.min(1, Math.max(0, sum));
}
export function binomialInterval(successes: number, n: number, alpha = 0.05): Interval {
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    !Number.isSafeInteger(successes) ||
    successes < 0 ||
    successes > n ||
    !(alpha > 0 && alpha < 1)
  )
    throw new Error('Invalid binomial inputs');
  if (!n) return { lower: 0, upper: 1 };
  function invert(k: number, target: number) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 64; i++) {
      const mid = (low + high) / 2;
      if (cdf(n, k, mid) > target) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }
  return {
    lower: successes === 0 ? 0 : invert(successes - 1, 1 - alpha / 2),
    upper: successes === n ? 1 : invert(successes, alpha / 2),
  };
}
interface Counts {
  selectedTrials: number;
  retainedTrials: number;
  missingTrials: number;
  passes: number;
  budgetExceeded: number;
  contextExceeded: number;
  ordinaryFailures: number;
  stages: Record<string, number>;
  causes: Record<string, number>;
  inputTokens: number | null;
  outputTokens: number | null;
  retries: number | null;
  compactions: number | null;
  repeatedCallNotices: number | null;
  editFailures: number | null;
  malformedToolCalls: number | null;
  medianSeconds: number | null;
  medianTools: number | null;
}
export interface Cell extends Counts {
  task: string;
  lane: Lane;
  group: string;
  family: string;
  split: string;
  passRate: number | null;
  interval: Interval;
  simultaneousInterval: Interval;
  piDelta: number | null;
  piDeltaInterval: Interval | null;
}
export interface Group extends Counts {
  lane: Lane;
  group: string;
  split: string;
  taskCount: number;
  familyCount: number;
  passRate: number | null;
  interval: Interval;
  piDelta: number | null;
  piDeltaInterval: Interval | null;
}
export interface Statistics {
  version: 1;
  purpose: string;
  qualityEstimateAvailable: boolean;
  selectedMatrixKnown: boolean;
  selectedTrials: number;
  retainedTrials: number;
  missingTrials: number;
  method: {
    name: string;
    confidence: number;
    simultaneousCellCount: number;
    estimand: string;
    assumptions: string[];
  };
  cells: Cell[];
  groups: Group[];
  limitations: string[];
}
const identity = (trial: Trial) => JSON.stringify([trial.task, trial.lane, trial.runIndex]);
function counts(rows: Run[], selected: number): Counts {
  const stages: Record<string, number> = {};
  const causes: Record<string, number> = {};
  for (const row of rows) {
    if (row.outcome === 'pass') continue;
    const stage =
      row.stage ??
      (row.agentStatus === 'done' || row.agentStatus === 'not-run' ? 'functional' : 'agent');
    stages[stage] = (stages[stage] ?? 0) + 1;
    const cause = row.failureClass ?? 'unknown';
    causes[cause] = (causes[cause] ?? 0) + 1;
  }
  const median = (values: number[]): number | null => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  };
  return {
    selectedTrials: selected,
    retainedTrials: rows.length,
    missingTrials: selected - rows.length,
    passes: rows.filter((row) => row.outcome === 'pass').length,
    budgetExceeded: rows.filter((row) => row.outcome === 'budget-exceeded').length,
    contextExceeded: rows.filter((row) => row.outcome === 'context-exceeded').length,
    ordinaryFailures: rows.filter((row) => row.outcome === 'fail').length,
    stages,
    causes,
    ...(Object.fromEntries(
      metricKeys.map((key) => [
        key,
        rows.some((row) => row[key] === undefined || row.unavailableMetrics?.includes(key))
          ? null
          : rows.reduce((sum, row) => sum + row[key], 0),
      ]),
    ) as Pick<Counts, (typeof metricKeys)[number]>),
    medianSeconds: median(rows.map((row) => row.elapsedMs / 1000)),
    medianTools: median(rows.map((row) => row.toolCalls)),
  };
}
export function deriveStatistics(report: Report): Statistics {
  const plan = report.header.plan;
  if (plan && report.header.series && !isDeepStrictEqual(plan.trials, report.header.series.trials))
    throw new Error('Plan/series trial identities disagree');
  const matrix =
    plan?.trials ??
    report.header.series?.trials ??
    report.runs.map(({ task, lane, runIndex }) => ({ task, lane, runIndex }));
  const expected = new Set<string>();
  const groups = new Map<string, Trial[]>();
  for (const trial of matrix) {
    if (
      !trial.task ||
      !allLanes.includes(trial.lane) ||
      !Number.isSafeInteger(trial.runIndex) ||
      trial.runIndex < 1 ||
      trial.runIndex > report.header.runsPerTask ||
      expected.has(identity(trial))
    )
      throw new Error('Invalid/duplicate selected identity');
    if (plan && !plan.tasks.some((task) => task.id === trial.task))
      throw new Error('Selected task missing from plan');
    expected.add(identity(trial));
    const key = JSON.stringify([trial.task, trial.lane]);
    const list = groups.get(key) ?? [];
    list.push(trial);
    groups.set(key, list);
  }
  const observed = new Set<string>();
  for (const row of report.runs) {
    const key = identity(row);
    if (observed.has(key) || !expected.has(key))
      throw new Error(`Duplicate/out-of-plan attempt: ${key}`);
    observed.add(key);
    if (!['pass', 'fail', 'budget-exceeded', 'context-exceeded'].includes(row.outcome))
      throw new Error('Invalid outcome');
    for (const metric of [...metricKeys, 'elapsedMs', 'toolCalls'] as const) {
      if (!plan && row[metric] === undefined && metricKeys.some((key) => key === metric)) continue;
      if (!Number.isFinite(row[metric]) || row[metric] < 0)
        throw new Error(`Invalid metric: ${metric}`);
    }
    if (row.outcome === 'pass' && !row.judge.pass) throw new Error('Pass without judge proof');
  }
  const purpose =
    report.header.purpose ?? (report.header.model === 'scripted' ? 'smoke' : 'quality');
  const known = !!plan;
  const quality = purpose === 'quality' && known;
  const simultaneousAlpha = 0.05 / Math.max(1, groups.size);
  const cells: Cell[] = [...groups.values()].map((trials) => {
    const first = trials[0]!;
    const rows = report.runs.filter((row) => row.task === first.task && row.lane === first.lane);
    const meta = plan?.tasks.find((task) => task.id === first.task);
    const count = counts(rows, trials.length);
    const complete = quality && count.missingTrials === 0;
    return {
      ...count,
      task: first.task,
      lane: first.lane,
      group: meta?.group ?? 'smoke',
      family: meta?.family ?? 'legacy',
      split: meta?.split ?? 'smoke',
      passRate: complete ? count.passes / count.selectedTrials : null,
      interval: complete
        ? binomialInterval(count.passes, count.selectedTrials)
        : { lower: 0, upper: 1 },
      simultaneousInterval: complete
        ? binomialInterval(count.passes, count.selectedTrials, simultaneousAlpha)
        : { lower: 0, upper: 1 },
      piDelta: null,
      piDeltaInterval: null,
    };
  });
  for (const cell of cells) {
    const native = cells.find((row) => row.task === cell.task && row.lane === 'local-reference');
    if (
      cell.lane === 'native-codex' ||
      cell.passRate === null ||
      native?.passRate === undefined ||
      native.passRate === null
    )
      continue;
    cell.piDelta = cell.passRate - native.passRate;
    cell.piDeltaInterval =
      cell.lane === 'local-reference'
        ? { lower: 0, upper: 0 }
        : {
            lower: cell.simultaneousInterval.lower - native.simultaneousInterval.upper,
            upper: cell.simultaneousInterval.upper - native.simultaneousInterval.lower,
          };
  }
  const grouping = new Map<string, Cell[]>();
  for (const cell of cells) {
    for (const group of [
      cell.group,
      'all',
      ...(['bug', 'feature'].includes(cell.group) ? ['project-change'] : []),
    ]) {
      const key = JSON.stringify([cell.split, group, cell.lane]);
      const list = grouping.get(key) ?? [];
      list.push(cell);
      grouping.set(key, list);
    }
  }
  const summaries: Group[] = [...grouping.entries()].map(([key, cells]) => {
    const [split, group, lane] = JSON.parse(key) as [string, string, Lane];
    const ids = new Set(cells.map((cell) => cell.task));
    const rows = report.runs.filter((row) => row.lane === lane && ids.has(row.task));
    const complete = cells.every((cell) => cell.passRate !== null);
    const average = (fn: (cell: Cell) => number) =>
      cells.reduce((sum, cell) => sum + fn(cell), 0) / cells.length;
    return {
      ...counts(
        rows,
        cells.reduce((sum, cell) => sum + cell.selectedTrials, 0),
      ),
      split,
      group,
      lane,
      taskCount: ids.size,
      familyCount: new Set(cells.map((cell) => cell.family)).size,
      passRate: complete ? average((cell) => cell.passRate!) : null,
      interval: {
        lower: average((cell) => cell.simultaneousInterval.lower),
        upper: average((cell) => cell.simultaneousInterval.upper),
      },
      piDelta: null,
      piDeltaInterval: null,
    };
  });
  for (const group of summaries) {
    const native = summaries.find(
      (row) =>
        row.split === group.split && row.group === group.group && row.lane === 'local-reference',
    );
    if (
      group.lane === 'native-codex' ||
      group.passRate === null ||
      native?.passRate === undefined ||
      native.passRate === null
    )
      continue;
    group.piDelta = group.passRate - native.passRate;
    group.piDeltaInterval =
      group.lane === 'local-reference'
        ? { lower: 0, upper: 0 }
        : {
            lower: group.interval.lower - native.interval.upper,
            upper: group.interval.upper - native.interval.lower,
          };
  }
  return {
    version: 1,
    purpose,
    qualityEstimateAvailable: quality,
    selectedMatrixKnown: known,
    selectedTrials: matrix.length,
    retainedTrials: report.runs.length,
    missingTrials: matrix.length - report.runs.length,
    method: {
      name: 'Clopper–Pearson exact binomial; Bonferroni simultaneous finite-cell task-macro bands',
      confidence: 0.95,
      simultaneousCellCount: groups.size,
      estimand:
        'Pass probability of these fixed task/pipelines under declared settings; equal task weights within groups',
      assumptions: [
        'iid repeated trials within each task/lane, conditional on fixed settings; provider/cache correlations may violate this',
        'No between-cell independence required for finite-cell union bounds',
        'No general programming-task population or environment-only causal inference',
      ],
    },
    cells,
    groups: summaries,
    limitations: [
      ...(!quality
        ? [
            'No coding-quality inference: non-model/smoke evidence or missing immutable legacy plan.',
          ]
        : []),
      'Pass means the frozen functional/regression checks passed, not a universal program proof.',
      'Few repeats yield wide conditional intervals; these data do not establish equality/equivalence.',
      'Missing selected attempts have unavailable point estimates; retained failures remain selected.',
      'Native Codex is a separate model/context reference, no Pi delta.',
    ],
  };
}
export function statisticsLines(stats: Statistics): string[] {
  const value = (n: number | null) => (n === null ? 'unavailable' : n.toFixed(3));
  const band = (i: Interval) => `[${i.lower.toFixed(3)}, ${i.upper.toFixed(3)}]`;
  const lines = [
    '',
    '## Fixed-matrix outcomes',
    '',
    `Purpose: ${stats.purpose}; selected ${stats.selectedTrials}; retained ${stats.retainedTrials}; missing ${stats.missingTrials}.`,
    stats.method.name,
    ...stats.method.assumptions.map((line) => `${line}.`),
    ...stats.limitations.map((line) => `${line}`),
    '',
    '| Task | Split/group | Lane | Pass/selected | Missing | Budget/context | Rate | CP95% | Pi delta | Simultaneous delta band | Failure stages | Tokens in/out |',
    '|---|---|---|---:|---:|---:|---:|---|---:|---|---|---|',
  ];
  for (const cell of stats.cells)
    lines.push(
      `| ${cell.task} | ${cell.split}/${cell.group} | ${cell.lane} | ${cell.passes}/${cell.selectedTrials} | ${cell.missingTrials} | ${cell.budgetExceeded}/${cell.contextExceeded} | ${value(cell.passRate)} | ${band(cell.interval)} | ${cell.lane === 'native-codex' ? 'separate reference' : value(cell.piDelta)} | ${cell.piDeltaInterval ? band(cell.piDeltaInterval) : 'unavailable'} | ${JSON.stringify(cell.stages)} | ${cell.inputTokens ?? 'unknown'}/${cell.outputTokens ?? 'unknown'} |`,
    );
  lines.push(
    '',
    'Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):',
    '',
    '| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |',
    '|---|---|---|---:|---:|---:|---:|---|---:|---|',
  );
  for (const group of stats.groups)
    lines.push(
      `| ${group.split} | ${group.group} | ${group.lane} | ${group.taskCount}/${group.familyCount} | ${group.passes}/${group.selectedTrials} | ${group.missingTrials} | ${value(group.passRate)} | ${band(group.interval)} | ${group.lane === 'native-codex' ? 'separate reference' : value(group.piDelta)} | ${group.piDeltaInterval ? band(group.piDeltaInterval) : 'unavailable'} |`,
    );
  return lines;
}
export function assertComparablePlans(before: Report, after: Report): void {
  const select = (plan: Plan | undefined) =>
    plan ? { tasks: plan.tasks, trials: plan.trials } : null;
  if (!isDeepStrictEqual(select(before.header.plan), select(after.header.plan)))
    throw new Error('Incompatible comparison task/input/judge/selection identity');
  for (const report of [before, after])
    if (report.header.series && report.header.series.status !== 'completed')
      throw new Error('Incomplete comparison series');
}
