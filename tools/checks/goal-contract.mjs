#!/usr/bin/env node
/**
 * Run-goal tripwire. `Goal-Baseline: <epic>@<exact SHA>` freezes the epic's
 * observable promise across every implementation slice. Item order and run
 * bookkeeping stay mutable; value, tier, Outcome, User scenario, Invariants
 * do not.
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

function withoutGoalBaseline(text) {
  return text.replace(/^goal_baseline:\s*[^\r\n]*(?:\r?\n|$)/mu, '');
}

/**
 * Validate one epic's marker along first-parent history. `states[0]` is the
 * merge-base; every following state is one commit through HEAD.
 */
export function evaluateMarkerHistory(path, states, hasNonContractChanges, declaredGoal) {
  const violations = [];
  const slug = EPIC_PATH_RE.exec(path)?.[1] ?? null;
  const baseMarker = inspectGoalBaseline(states[0]?.text ?? null);
  if (baseMarker.error !== null) {
    violations.push(`${path}: merge-base ${baseMarker.error}`);
    return { canonical: null, deleted: false, introduced: false, violations };
  }

  let canonical = baseMarker.value;
  let deleted = false;
  let introduced = false;
  for (let index = 1; index < states.length; index += 1) {
    const previous = states[index - 1];
    const current = states[index];
    const marker = inspectGoalBaseline(current.text);
    if (marker.error !== null) {
      violations.push(`${path}@${current.sha.slice(0, 12)}: ${marker.error}`);
      continue;
    }

    if (canonical !== null) {
      if (current.text === null) {
        deleted = true;
        continue;
      }
      if (deleted) {
        violations.push(`${path}: marker-bearing epic reappeared after deletion`);
        continue;
      }
      if (marker.value !== canonical) {
        violations.push(
          `${path}: active goal_baseline changed from ${canonical} to ${marker.value ?? 'missing'}`,
        );
      }
      continue;
    }

    if (current.text === null || marker.value === null) continue;
    introduced = true;
    canonical = marker.value;
    if (hasNonContractChanges) {
      violations.push(
        `${path}: establish and land goal_baseline in a contract-only PR before source work`,
      );
    }
    if (previous.text === null) {
      violations.push(`${path}: goal_baseline parent lacks the ready epic`);
      continue;
    }
    if (canonical !== previous.sha) {
      violations.push(
        `${path}: new goal_baseline must equal its marker commit parent ${previous.sha}`,
      );
    }
    if (frontmatterValue(previous.text, 'status') !== 'ready') {
      violations.push(`${path}: goal_baseline parent must contain a ready epic`);
    }
    const baseline = goalContract(previous.text);
    if (
      baseline === null ||
      baseline.value === null ||
      baseline.tier === null ||
      baseline.outcome === null ||
      baseline.userScenario === null ||
      baseline.invariants === null
    ) {
      violations.push(`${path}: goal_baseline parent lacks the complete observable contract`);
    }
    if (withoutGoalBaseline(current.text) !== previous.text) {
      violations.push(`${path}: marker commit may only add goal_baseline`);
    }
  }

  if (
    canonical !== null &&
    deleted &&
    (declaredGoal?.epicSlug !== slug || declaredGoal.sha !== canonical)
  ) {
    violations.push(`${path}: deleting an active goal requires its matching Goal-Baseline`);
  }
  return { canonical, deleted, introduced, violations };
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

function historyChangedPaths(base, commits) {
  const paths = new Set();
  let parent = base;
  for (const commit of commits) {
    const rows = git('diff', '--name-status', parent, commit).trim().split('\n').filter(Boolean);
    for (const row of rows) {
      for (const path of row.split('\t').slice(1)) paths.add(path);
    }
    parent = commit;
  }
  return paths;
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
  let mergeBase;
  try {
    mergeBase = git('merge-base', 'origin/main', 'HEAD').trim();
  } catch {
    if (declarations.length === 0) {
      console.log('goal-contract: SKIPPED — no origin/main merge-base');
      return;
    }
    console.error('goal-contract: ✗ no origin/main merge-base; run marker cannot be checked');
    process.exit(1);
  }

  const commits = git('rev-list', '--first-parent', '--reverse', `${mergeBase}..HEAD`)
    .trim()
    .split('\n')
    .filter(Boolean);
  const changedPaths = historyChangedPaths(mergeBase, commits);
  const goal = declarations.length === 1 ? parseGoalBaseline(declarations[0]) : null;
  const paths = new Set([...changedPaths].filter((path) => EPIC_PATH_RE.test(path)));
  if (goal !== null) paths.add(`docs/backlog/epics/${goal.epicSlug}.md`);
  const hasNonContractChanges = !isContractOnlyBootstrap([...changedPaths]);
  const histories = new Map();
  const markerViolations = [];
  for (const path of paths) {
    const states = [
      { sha: mergeBase, text: showText(mergeBase, path) },
      ...commits.map((sha) => ({ sha, text: showText(sha, path) })),
    ];
    const result = evaluateMarkerHistory(path, states, hasNonContractChanges, goal);
    histories.set(path, result);
    markerViolations.push(...result.violations);
    if (result.canonical !== null && !result.deleted) {
      try {
        git('merge-base', '--is-ancestor', result.canonical, 'HEAD');
      } catch {
        markerViolations.push(
          `${path}: goal_baseline ${result.canonical} is unavailable or not an ancestor`,
        );
        continue;
      }
      const baseline = showText(result.canonical, path);
      const current = readFileSync(path, 'utf8');
      if (baseline === null) {
        markerViolations.push(`${path}: goal_baseline commit does not contain the epic`);
      } else {
        markerViolations.push(...evaluateGoal(baseline, current, []).map((v) => `${path}: ${v}`));
      }
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
  let baselineText;
  try {
    baselineText = git('show', `${goal.sha}:${path}`);
  } catch {
    console.error(`goal-contract: ✗ ${path} does not exist at ${goal.sha}`);
    process.exit(1);
  }
  let currentText = null;
  try {
    currentText = readFileSync(path, 'utf8');
  } catch {
    /* delete-on-done candidate */
  }
  const residuals = linkedItems(goal.epicSlug);
  const violations = evaluateGoal(baselineText, currentText, residuals);
  if (violations.length > 0) {
    console.error(`goal-contract: ${violations.length} violation(s) for ${declarations[0]}:`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  const state =
    currentText === null ? 'closure candidate' : `${residuals.length} open child item(s)`;
  console.log(`goal-contract: OK (${declarations[0]}: ${state})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
