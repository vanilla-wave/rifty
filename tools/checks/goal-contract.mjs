#!/usr/bin/env node
/**
 * Run-goal tripwire. `Goal-Baseline: <epic>@<run-id>` freezes the epic's
 * observable promise across every implementation slice. Every check compares
 * merge-base content vs PR-head content of the aggregate diff; goal_baseline
 * is a write-once opaque 40-hex run id — never dereferenced, no history walk.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARDED_STATUSES = new Set(['ready', 'in-progress']);
const EXACT_SHA_RE = /^[0-9a-f]{40}$/u;
const EPIC_PATH_RE = /^docs\/backlog\/epics\/(?!README\.md$|TEMPLATE\.md$)([\w-]+)\.md$/u;
const BACKLOG_CONTRACT_RE = /^docs\/.+\.md$/u; // contract-side docs: backlog, ADR, process

/** Every Goal-Baseline declaration from env or the GitHub PR body. */
export function declaredGoals(env, readEvent) {
  if (env.RIFTY_GOAL_BASELINE) return [env.RIFTY_GOAL_BASELINE.trim()];
  if (!env.GITHUB_EVENT_PATH) return [];
  try {
    const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
    const body = event?.pull_request?.body ?? '';
    return [...body.matchAll(/^Goal-Baseline:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
  } catch {
    return [];
  }
}

/** Exact run declaration, or null when malformed. */
export function parseGoalBaseline(value) {
  const match = /^([\w-]+)@([0-9a-f]{40})$/u.exec(value ?? '');
  return match ? { epicSlug: match[1], sha: match[2] } : null;
}

/**
 * PR-head identity. GitHub checks out a synthetic merge commit for PR jobs;
 * gates must read HEAD content from the exact PR head recorded in the event.
 */
export function historyHeadRevision(env, readEvent) {
  if (!env.GITHUB_EVENT_PATH) return { revision: 'HEAD', kind: 'checkout', error: null };
  let event;
  try {
    event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
  } catch {
    return { revision: null, kind: 'event', error: 'cannot read GitHub event for history head' };
  }
  if (event?.pull_request === undefined) {
    return { revision: 'HEAD', kind: 'checkout', error: null };
  }
  const revision = event.pull_request?.head?.sha;
  return EXACT_SHA_RE.test(revision ?? '')
    ? { revision, kind: 'pull-request', error: null }
    : {
        revision: null,
        kind: 'pull-request',
        error: 'pull_request.head.sha must be one exact 40-hex commit',
      };
}

function frontmatterValue(text, key) {
  return frontmatterValues(text, key)[0] ?? null;
}

function frontmatterValues(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/mu.exec(text ?? '')?.[1];
  if (!frontmatter) return [];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...frontmatter.matchAll(new RegExp(`^${escaped}:\\s*([^\\r\\n]*?)\\s*$`, 'gmu'))].map(
    (match) => match[1],
  );
}

function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^##\\s+${escaped}\\s*$\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, 'mu')
      .exec(text ?? '')?.[1]
      ?.trim() ?? null
  );
}

/** Canonical observable part of a ready epic. */
export function goalContract(text) {
  if (text === null || text === undefined) return null;
  return {
    value: frontmatterValue(text, 'value'),
    tier: frontmatterValue(text, 'tier'),
    outcome: section(text, 'Outcome'),
    userScenario: section(text, 'User scenario'),
    invariants: section(text, 'Invariants'),
  };
}

/** Persistent cross-PR baseline marker stored in the live epic. */
export function recordedGoalBaseline(text) {
  const marker = inspectGoalBaseline(text);
  return marker.error === null ? marker.value : null;
}

/** Marker parse that distinguishes absence from malformed/duplicate state. */
export function inspectGoalBaseline(text) {
  const values = frontmatterValues(text, 'goal_baseline');
  if (values.length === 0) return { value: null, error: null };
  if (values.length !== 1) {
    return { value: null, error: `want one goal_baseline, got ${values.length}` };
  }
  if (!EXACT_SHA_RE.test(values[0])) {
    return { value: null, error: 'goal_baseline must be one exact 40-hex commit' };
  }
  return { value: values[0], error: null };
}

/** Compare baseline with HEAD; linkedItems are reverse-linked open residuals. */
export function evaluateGoal(baselineText, currentText, linkedItems) {
  const violations = [];
  const baselineStatus = frontmatterValue(baselineText, 'status');
  if (!GUARDED_STATUSES.has(baselineStatus)) {
    violations.push(
      `goal baseline must be ready or in-progress, got ${baselineStatus ?? 'missing'}`,
    );
    return violations;
  }
  const baseline = goalContract(baselineText);
  if (
    baseline === null ||
    baseline.value === null ||
    baseline.tier === null ||
    baseline.outcome === null ||
    baseline.userScenario === null ||
    baseline.invariants === null
  ) {
    violations.push('goal baseline lacks value, tier, Outcome, User scenario, or Invariants');
    return violations;
  }
  if (currentText === null) {
    if (linkedItems.length > 0) {
      violations.push(`goal epic deleted with open residual items: ${linkedItems.join(', ')}`);
    }
    return violations;
  }
  const currentStatus = frontmatterValue(currentText, 'status');
  if (!GUARDED_STATUSES.has(currentStatus)) {
    violations.push(`goal epic demoted to ${currentStatus ?? 'missing'} while the run is active`);
  }
  const current = goalContract(currentText);
  for (const [key, label] of [
    ['value', 'value'],
    ['tier', 'tier'],
    ['outcome', 'Outcome'],
    ['userScenario', 'User scenario'],
    ['invariants', 'Invariants'],
  ]) {
    if (baseline[key] !== current?.[key]) violations.push(`frozen ${label} changed from baseline`);
  }
  return violations;
}

/**
 * One epic's marker transition, merge-base content vs head content.
 * `contractOnlyPR` covers ALL aggregate changed paths; `declaredGoal` is the
 * parsed Goal-Baseline or null.
 */
export function evaluateMarkerTransition(
  path,
  baseText,
  headText,
  { contractOnlyPR, declaredGoal },
) {
  const violations = [];
  const slug = EPIC_PATH_RE.exec(path)?.[1] ?? null;
  const base = inspectGoalBaseline(baseText);
  if (base.error !== null) {
    violations.push(`${path}: merge-base ${base.error}`);
    return { canonical: null, deleted: false, introduced: false, violations };
  }
  const head = inspectGoalBaseline(headText);
  if (head.error !== null) {
    violations.push(`${path}: ${head.error}`);
    return { canonical: base.value, deleted: false, introduced: false, violations };
  }

  if (base.value !== null) {
    if (headText === null) {
      if (declaredGoal?.epicSlug !== slug || declaredGoal.sha !== base.value) {
        violations.push(`${path}: deleting an active goal requires its matching Goal-Baseline`);
      }
      return { canonical: base.value, deleted: true, introduced: false, violations };
    }
    if (head.value === null) {
      violations.push(`${path}: goal_baseline removed while the run is active`);
      return { canonical: base.value, deleted: false, introduced: false, violations };
    }
    if (head.value !== base.value) {
      violations.push(`${path}: active goal_baseline changed from ${base.value} to ${head.value}`);
      return { canonical: base.value, deleted: false, introduced: false, violations };
    }
    violations.push(...evaluateGoal(baseText, headText, []).map((v) => `${path}: ${v}`));
    return { canonical: base.value, deleted: false, introduced: false, violations };
  }

  if (head.value === null) {
    return { canonical: null, deleted: false, introduced: false, violations };
  }
  // Bootstrap: marker absent at merge-base, present at head.
  if (!contractOnlyPR) {
    violations.push(
      `${path}: establish and land goal_baseline in a contract-only PR before source work`,
    );
  }
  const contract = goalContract(headText);
  if (
    frontmatterValue(headText, 'status') !== 'ready' ||
    contract.value === null ||
    contract.tier === null ||
    contract.outcome === null ||
    contract.userScenario === null ||
    contract.invariants === null
  ) {
    violations.push(`${path}: goal_baseline epic lacks the complete observable contract`);
  }
  return { canonical: head.value, deleted: false, introduced: true, violations };
}

/** A closing goal cannot be replaced/renamed through another epic in the PR. */
export function closureIdentityViolations(histories) {
  const changedPaths = [...histories.keys()];
  const violations = [];
  for (const [path, history] of histories) {
    if (history.canonical === null || !history.deleted) continue;
    const others = changedPaths.filter((candidate) => candidate !== path);
    if (others.length > 0) {
      violations.push(
        `${path}: terminal goal closure cannot also change another epic identity: ${others.join(', ')}`,
      );
    }
  }
  return violations;
}

/** Marker bootstrap is contract-only: backlog markdown and nothing else. */
export function isContractOnlyBootstrap(paths) {
  return paths.every((path) => BACKLOG_CONTRACT_RE.test(path));
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function showText(revision, path) {
  try {
    return git('show', `${revision}:${path}`);
  } catch {
    return null;
  }
}

function headTextOf(revision, path) {
  if (revision === 'HEAD') {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
  return showText(revision, path);
}

function walkMarkdown(dir) {
  const paths = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
  }
  return paths;
}

function linkedItems(epicSlug) {
  const root = join(process.cwd(), 'docs', 'backlog');
  return walkMarkdown(root)
    .filter((path) => !path.includes(`${join('docs', 'backlog', 'epics')}/`))
    .filter((path) => frontmatterValue(readFileSync(path, 'utf8'), 'epic') === epicSlug)
    .map((path) => relative(root, path).replace(/\.md$/u, ''))
    .sort();
}

function main() {
  const declarations = declaredGoals(process.env, (path) => readFileSync(path, 'utf8'));
  const historyHead = historyHeadRevision(process.env, (path) => readFileSync(path, 'utf8'));
  if (historyHead.error !== null) {
    console.error(`goal-contract: ✗ ${historyHead.error}`);
    process.exit(1);
  }
  const revision = historyHead.revision;
  let mergeBase;
  try {
    mergeBase = git('merge-base', 'origin/main', revision).trim();
  } catch {
    if (declarations.length === 0 && historyHead.kind !== 'pull-request') {
      console.log('goal-contract: SKIPPED — no origin/main merge-base');
      return;
    }
    console.error(
      `goal-contract: ✗ no origin/main merge-base for ${historyHead.kind} history; marker cannot be checked`,
    );
    process.exit(1);
  }

  const changedPaths = new Set();
  const rows = git('diff', '--name-status', mergeBase, revision).trim().split('\n').filter(Boolean);
  for (const row of rows) {
    for (const path of row.split('\t').slice(1)) changedPaths.add(path);
  }
  const goal = declarations.length === 1 ? parseGoalBaseline(declarations[0]) : null;
  const paths = new Set([...changedPaths].filter((path) => EPIC_PATH_RE.test(path)));
  if (goal !== null) paths.add(`docs/backlog/epics/${goal.epicSlug}.md`);
  const contractOnlyPR = isContractOnlyBootstrap([...changedPaths]);
  const histories = new Map();
  const markerViolations = [];
  for (const path of paths) {
    const baseText = showText(mergeBase, path);
    const headText = headTextOf(revision, path);
    const result = evaluateMarkerTransition(path, baseText, headText, {
      contractOnlyPR,
      declaredGoal: goal,
    });
    histories.set(path, result);
    markerViolations.push(...result.violations);
    if (result.canonical !== null && result.deleted) {
      const residuals = linkedItems(EPIC_PATH_RE.exec(path)?.[1] ?? '');
      markerViolations.push(...evaluateGoal(baseText, null, residuals).map((v) => `${path}: ${v}`));
    }
  }
  markerViolations.push(...closureIdentityViolations(histories));
  if (markerViolations.length > 0) {
    console.error(`goal-contract: ${markerViolations.length} marker violation(s):`);
    for (const violation of markerViolations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }

  if (declarations.length === 0) {
    const introductions = [...histories.values()].filter((history) => history.introduced).length;
    const detail =
      introductions === 0
        ? 'no autonomous goal declared'
        : `${introductions} marker(s) established`;
    console.log(`goal-contract: OK — ${detail}`);
    return;
  }
  if (declarations.length !== 1) {
    console.error(`goal-contract: ✗ want exactly one Goal-Baseline, got ${declarations.length}`);
    process.exit(1);
  }
  if (!goal) {
    console.error(
      `goal-contract: ✗ malformed "${declarations[0]}" (want <epic-slug>@<40-hex-sha>)`,
    );
    process.exit(1);
  }

  const path = `docs/backlog/epics/${goal.epicSlug}.md`;
  const history = histories.get(path);
  if (history?.canonical !== goal.sha) {
    console.error(
      `goal-contract: ✗ ${path} keeps goal_baseline ${history?.canonical ?? 'missing'}, PR declares ${goal.sha}`,
    );
    process.exit(1);
  }
  const state = history.deleted
    ? 'closure candidate'
    : `${linkedItems(goal.epicSlug).length} open child item(s)`;
  console.log(`goal-contract: OK (${declarations[0]}: ${state})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
