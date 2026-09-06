#!/usr/bin/env node
// Read a rifty-review verdict, validate coverage + authority, print slice + goal state.
// Rules: docs/process/rules/review.md (REV-2 authority, REV-3 severity, REV-4 coverage);
// exit codes: docs/process/artifacts/verdict.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tracedRowCount } from '../checks/contract-drift.mjs';

const CONTRACT_PATH_RE = /docs\/backlog\/[^\s`'"@]+\.md/u;
const FIDELITY_AUTHORITY_RE = /AGENTS\.md|Fidelity/iu;

export const REQUIRED_AXES = [
  'Completeness',
  'Mission and architecture',
  'Goal drift',
  'Approach cost',
  'Scope',
  'Bugs',
  'Regressions',
  'Ecosystem UX',
];

function residuals(value) {
  return Array.isArray(value) ? value : null;
}

/**
 * @param {unknown} verdict
 * @param {unknown[]|null} adjudication
 * @param {((path: string) => string|null)|null} readContract  head text of the unit contract (null = no reader)
 */
export function evaluateVerdict(verdict, adjudication = null, readContract = null) {
  const errors = [];
  const axes = Array.isArray(verdict?.axes) ? verdict.axes : null;
  const rulings = new Map();
  const clauses = new Map();
  if (adjudication !== null) {
    if (!Array.isArray(adjudication)) errors.push('adjudication is not an array');
    for (const entry of Array.isArray(adjudication) ? adjudication : []) {
      if (!['HOLDS', 'STRETCH', 'FALSE'].includes(entry?.ruling)) {
        errors.push(
          `adjudication entry without valid ruling: ${entry?.summary?.slice(0, 60) ?? '?'}`,
        );
      } else if (typeof entry.summary !== 'string' || entry.summary.length === 0) {
        errors.push('adjudication entry without summary');
      } else {
        rulings.set(entry.summary, entry.ruling);
        clauses.set(entry.summary, entry.clause ?? '');
      }
    }
  }
  const unitResiduals = residuals(verdict?.unit_residuals);
  const goalResiduals = residuals(verdict?.goal_residuals);
  // A row traced only to a rule id is a carrier note (RDY-3, REV-4): it raises no coverage row.
  // An ADR trace is an obligation (RDY-3) and stays.
  const RULE_ID_TRACE_RE = /^→?\s*(?!ADR-)[A-Z]{2,5}-\d+\s*$/u;
  const coverage = Array.isArray(verdict?.coverage)
    ? verdict.coverage.filter((row) => !RULE_ID_TRACE_RE.test(String(row?.trace ?? '')))
    : null;
  if (!axes) errors.push('axes missing');
  if (!coverage) errors.push('coverage missing');
  // One coverage row per traced obligation of the contract (REV-4): fewer rows than the contract
  // traces is an incomplete verdict, whatever the reviewer graded.
  const contractPath = CONTRACT_PATH_RE.exec(String(verdict?.unit_goal_source ?? ''))?.[0] ?? null;
  // With a reader (the CLI passes the file system): a named contract must be readable and the
  // coverage table at least as long as its traced obligations. Without one, the shape check only.
  const contractText = contractPath && readContract ? readContract(contractPath) : null;
  if (contractPath && readContract && contractText === null) {
    errors.push(`unit_goal_source names an unreadable contract: ${contractPath}`);
  }
  if (coverage && typeof contractText === 'string') {
    const obligations = tracedRowCount(contractText);
    if (coverage.length < obligations) {
      errors.push(
        `coverage has ${coverage.length} rows for ${obligations} traced obligations in ${contractPath} (REV-4)`,
      );
    }
  }
  for (const row of coverage ?? []) {
    if (!['pass', 'weak', 'missing'].includes(row?.status)) {
      errors.push(`coverage row without valid status: ${row?.row ?? '?'}`);
    } else if (row.status !== 'pass' && !(typeof row.note === 'string' && row.note.length > 0)) {
      errors.push(`${row.status} coverage row without note: ${row.row}`);
    }
    if (!(typeof row?.trace === 'string' && row.trace.length > 0)) {
      errors.push(`coverage row without trace (REV-4): ${row?.row ?? '?'}`);
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
  const rawBlockers = findings.filter((finding) => finding.severity === 'blocker');
  const adjudicated = adjudication !== null;
  if (adjudicated) {
    const summaries = new Set(rawBlockers.map((finding) => finding.summary));
    for (const summary of rulings.keys()) {
      if (!summaries.has(summary)) {
        errors.push(`adjudication ruling matches no blocker: ${summary.slice(0, 80)}`);
      }
    }
    // A §Fidelity blocker is rejected only as FALSE with the carrier cited (file:line in the clause)
    // — never STRETCH (REV-12).
    for (const finding of rawBlockers) {
      const authority = String(finding.authority ?? '');
      if (!FIDELITY_AUTHORITY_RE.test(authority)) continue;
      // A Fidelity authority is written `AGENTS.md §Fidelity: <rule>` so reception cannot mistake it.
      if (!authority.startsWith('AGENTS.md §Fidelity')) {
        errors.push(
          `Fidelity authority must start with 'AGENTS.md §Fidelity': ${authority.slice(0, 60)}`,
        );
        continue;
      }
      const ruling = rulings.get(finding.summary);
      if (ruling === 'STRETCH') {
        errors.push(
          `STRETCH on a Fidelity blocker is not a ruling (REV-12): ${finding.summary.slice(0, 80)}`,
        );
      } else if (ruling === 'FALSE' && !/:\d+/u.test(String(clauses.get(finding.summary) ?? ''))) {
        errors.push(
          `FALSE on a Fidelity blocker without the carrier cited as file:line (REV-12): ${finding.summary.slice(0, 80)}`,
        );
      }
    }
    if (errors.length > 0) {
      return { code: 2, errors, blockers: [], concerns: [], nits: [], goalComplete: false, axes };
    }
  }
  // Residuals mirror the blocker rulings only when every blocker was ruled; a partial or empty
  // adjudication leaves them blocking as in raw mode (artifacts/verdict.md).
  const fullyRuled =
    adjudicated &&
    rawBlockers.length > 0 &&
    rawBlockers.every((finding) => rulings.has(finding.summary));
  const demoted = adjudicated
    ? rawBlockers
        .filter((finding) => ['STRETCH', 'FALSE'].includes(rulings.get(finding.summary)))
        .map((finding) => ({ ...finding, ruling: rulings.get(finding.summary) }))
    : [];
  const demotedSummaries = new Set(demoted.map((finding) => finding.summary));
  // Adjudicated: residuals mirror the blocker findings and follow their rulings — the
  // calibrated blocker set is the surviving findings; residuals stay report-only.
  const blockers = [
    ...rawBlockers.filter((finding) => !demotedSummaries.has(finding.summary)),
    ...(fullyRuled
      ? []
      : unitResiduals.map((residual) => ({ ...residual, axis: 'Unit residual' }))),
  ];
  const concerns = [...findings.filter((finding) => finding.severity === 'concern'), ...demoted];
  const nits = findings.filter((finding) => finding.severity === 'nit');
  const axisBlocker =
    axes.some((axis) => axis.verdict === 'blocker') || verdict.overall_verdict === 'blocker';
  const uncovered = coverage.filter((row) => row.status !== 'pass');
  const missing = coverage.some((row) => row.status === 'missing');
  // Blocking power = surviving blockers + missing rows; weak rows are advisory in both
  // modes (REV-4). Adjudicated: stored axis/overall verdicts predate demotion and are
  // ignored. Raw: the reviewer's axis/overall blocker verdict binds as-is.
  const hasBlocker = adjudicated
    ? blockers.length > 0 || missing
    : blockers.length > 0 || axisBlocker || missing;
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
    demoted,
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: blockers.mjs <verdict.json> [adjudication.json]');
    process.exit(2);
  }
  let verdict;
  let adjudication = null;
  try {
    verdict = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`unparseable verdict (${path}): ${error.message}`);
    process.exit(2);
  }
  if (process.argv[3]) {
    try {
      adjudication = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    } catch (error) {
      console.error(`unparseable adjudication (${process.argv[3]}): ${error.message}`);
      process.exit(2);
    }
  }
  const readContract = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  const result = evaluateVerdict(verdict, adjudication, readContract);
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
  if (result.demoted.length > 0) {
    console.log('DEMOTED BY ADJUDICATION:');
    for (const finding of result.demoted)
      console.log(`  - [${finding.ruling}] ${finding.summary?.slice(0, 120)}`);
  }
  process.exit(result.code);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
