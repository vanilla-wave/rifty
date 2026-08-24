#!/usr/bin/env node
// Read a rifty-review verdict, validate full coverage, print slice + goal state.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED_AXES = [
  'Completeness',
  'Mission and architecture',
  'Goal drift',
  'Approach cost',
  'Budget',
  'Bugs',
  'Regressions',
  'Ecosystem UX',
];

function residuals(value) {
  return Array.isArray(value) ? value : null;
}

export function evaluateVerdict(verdict) {
  const errors = [];
  const axes = Array.isArray(verdict?.axes) ? verdict.axes : null;
  const unitResiduals = residuals(verdict?.unit_residuals);
  const goalResiduals = residuals(verdict?.goal_residuals);
  const coverage = Array.isArray(verdict?.coverage) ? verdict.coverage : null;
  if (!axes) errors.push('axes missing');
  if (!coverage || coverage.length === 0) errors.push('coverage missing or empty');
  for (const row of coverage ?? []) {
    if (!['pass', 'weak', 'missing'].includes(row?.status)) {
      errors.push(`coverage row without valid status: ${row?.row ?? '?'}`);
    } else if (row.status !== 'pass' && !(typeof row.note === 'string' && row.note.length > 0)) {
      errors.push(`${row.status} coverage row without note: ${row.row}`);
    }
  }
  for (const axis of axes ?? []) {
    for (const finding of Array.isArray(axis?.findings) ? axis.findings : []) {
      if (
        finding?.severity === 'blocker' &&
        !(typeof finding.authority === 'string' && finding.authority.length > 0)
      ) {
        errors.push(`blocker without declared authority: ${finding?.summary?.slice(0, 80) ?? '?'}`);
      }
    }
  }
  if (!['Contract+RED', 'Final+GREEN'].includes(verdict?.checkpoint)) {
    errors.push('checkpoint missing or invalid');
  }
  if (typeof verdict?.unit_goal_source !== 'string' || verdict.unit_goal_source.length === 0) {
    errors.push('unit_goal_source missing');
  }
  if (!unitResiduals) errors.push('unit_residuals missing');
  if (!goalResiduals) errors.push('goal_residuals missing');
  if (typeof verdict?.goal_complete !== 'boolean') errors.push('goal_complete missing');
  if (axes) {
    for (const name of REQUIRED_AXES) {
      const count = axes.filter((axis) => axis?.axis === name).length;
      if (count !== 1) errors.push(`axis "${name}" occurs ${count} times`);
    }
    if (axes.length !== REQUIRED_AXES.length) errors.push('unexpected or duplicate axes');
    if (axes.map((axis) => axis?.axis).join('\n') !== REQUIRED_AXES.join('\n')) {
      errors.push('axes out of rubric order');
    }
  }
  if (
    verdict?.goal_complete === true &&
    ((goalResiduals?.length ?? 0) > 0 || (unitResiduals?.length ?? 0) > 0)
  ) {
    errors.push('goal_complete=true with open unit/goal residuals');
  }
  if (errors.length > 0) {
    return {
      code: 2,
      errors,
      blockers: [],
      concerns: [],
      nits: [],
      goalComplete: false,
      axes: axes ?? [],
    };
  }
  const findings = axes.flatMap((axis) =>
    (Array.isArray(axis.findings) ? axis.findings : []).map((finding) => ({
      ...finding,
      axis: axis.axis,
    })),
  );
  const blockers = [
    ...findings.filter((finding) => finding.severity === 'blocker'),
    ...unitResiduals.map((residual) => ({ ...residual, axis: 'Unit residual' })),
  ];
  const concerns = findings.filter((finding) => finding.severity === 'concern');
  const nits = findings.filter((finding) => finding.severity === 'nit');
  const axisBlocker =
    axes.some((axis) => axis.verdict === 'blocker') || verdict.overall_verdict === 'blocker';
  const uncovered = coverage.filter((row) => row.status !== 'pass');
  const hasBlocker = blockers.length > 0 || axisBlocker || uncovered.length > 0;
  return {
    code: hasBlocker ? 1 : 0,
    errors,
    blockers,
    concerns,
    nits,
    goalComplete: verdict.goal_complete && !hasBlocker,
    goalResiduals,
    axes,
    coverage,
    uncovered,
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: blockers.mjs <verdict.json>');
    process.exit(2);
  }
  let verdict;
  try {
    verdict = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`unparseable verdict (${path}): ${error.message}`);
    process.exit(2);
  }
  const result = evaluateVerdict(verdict);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`invalid verdict: ${error}`);
    process.exit(2);
  }
  const line = (finding) =>
    `  - [${finding.axis}] ${finding.location || '?'} — ${finding.summary || ''}`;
  console.log(`overall: ${verdict.overall_verdict}  |  merge: ${verdict.merge_call || '?'}`);
  console.log(`checkpoint: ${verdict.checkpoint}  |  unit: ${verdict.unit_goal_source}`);
  console.log(`axes: ${result.axes.map((axis) => `${axis.axis}=${axis.verdict}`).join(', ')}`);
  const byStatus = (status) => result.coverage.filter((row) => row.status === status).length;
  console.log(
    `coverage: ${result.coverage.length} rows — ${byStatus('pass')} pass, ${byStatus('weak')} weak, ${byStatus('missing')} missing`,
  );
  if (result.uncovered.length > 0) {
    console.log('UNCOVERED OBLIGATIONS:');
    for (const row of result.uncovered)
      console.log(`  - [${row.status}] (${row.source}) ${row.row} — ${row.note}`);
  }
  console.log(
    `findings: ${result.blockers.length} blocker, ${result.concerns.length} concern, ${result.nits.length} nit`,
  );
  console.log(
    `goal: ${result.goalComplete ? 'complete' : `continue (${result.goalResiduals.length} residual(s))`}`,
  );
  if (result.blockers.length > 0) {
    console.log('BLOCKERS:');
    for (const finding of result.blockers) console.log(line(finding));
  }
  if (result.concerns.length > 0) {
    console.log('CONCERNS:');
    for (const finding of result.concerns) console.log(line(finding));
  }
  process.exit(result.code);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
