#!/usr/bin/env node
/**
 * Budget tripwire (docs/backlog/README.md §Budget). An autonomous source PR
 * names exactly one same-epic Goal-Baseline + Budget-Slice. Authority is read
 * at pickup (parent of first source commit), so Contract+RED may add a JIT
 * ready item/row while later closure cannot erase or widen it. Hand-written
 * insertions: > band warns, >= 2× fails. AST mechanism detection is advisory;
 * review owns the full modified-file sweep.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { declaredGoals, parseGoalBaseline } from './goal-contract.mjs';
import { PRODUCTION_SOURCE_RE as SOURCE_RE, pickupCommit } from './run-pickup.mjs';

const MECHANISM_RE = /\b(epoch|generation|fifo|ledger|lease|seenRequest\w*|opId)\b/i;
const TEST_SOURCE_RE =
  /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)|\.(?:test|spec|test-fixture|contract-fixtures)\.[^.]+$/u;

/** `a/{b => c}/d` and `a => b` numstat paths resolve to the new path. */
export function newPath(path) {
  const braced = path
    .replace(/\{([^{}]*) => ([^{}]*)\}/g, (_, _from, to) => to)
    .replace(/\/\//g, '/');
  const match = /^(.*) => (.*)$/.exec(braced);
  return match ? match[2] : braced;
}

/** Minimal glob: `**` any, `*` within one segment. Anchored. */
export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('**')
    .map((part) => part.replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Parse an epic's `## Budget` section.
 * @returns {{slices: Map<string, {lo:number, hi:number}>, generated: RegExp[],
 *   mechanismsZero: boolean, substrate: string|null} | null}
 */
export function parseBudget(epicText) {
  const section = /^## Budget\s*$([\s\S]*?)(?=^## |\n*$(?![\s\S]))/m.exec(epicText ?? '');
  if (!section) return null;
  const body = section[1];
  const slices = new Map();
  for (const row of body.matchAll(
    /^\|\s*`?([\w./-]+)`?\s*\|\s*(\d[\d_]*)\s*[–-]\s*(\d[\d_]*)\s*\|/gm,
  )) {
    const [lo, hi] = [row[2], row[3]].map((value) => Number(value.replace(/_/g, '')));
    if (row[1] !== 'slice' && Number.isFinite(lo) && Number.isFinite(hi)) {
      slices.set(row[1], { lo, hi });
    }
  }
  const generated = [...body.matchAll(/^-\s*generated globs:\s*(.+)$/gim)].flatMap((match) =>
    [...match[1].matchAll(/`([^`]+)`/g)].map((glob) => globToRegExp(glob[1])),
  );
  const mechanisms = /^-\s*new coordination mechanisms:\s*0\b(.*)$/im.exec(body);
  const substrate = mechanisms
    ? (/substrate:\s*`?([\w./-]+)`?/.exec(mechanisms[1])?.[1] ?? null)
    : null;
  return { slices, generated, mechanismsZero: Boolean(mechanisms), substrate };
}

/**
 * @param {{added:number|null, path:string}[]} numstat  parsed rows (null = binary)
 * @param {{lo:number, hi:number}} band
 * @param {RegExp[]} generated
 * @returns {{insertions:number, level:'ok'|'warn'|'fail', message:string}}
 */
export function evaluateMass(numstat, band, generated) {
  let insertions = 0;
  for (const row of numstat) {
    if (row.added === null) continue;
    if (generated.some((regexp) => regexp.test(row.path))) continue;
    insertions += row.added;
  }
  const level = insertions >= 2 * band.hi ? 'fail' : insertions > band.hi ? 'warn' : 'ok';
  const message =
    level === 'ok'
      ? `${insertions} hand-written insertions within band ${band.lo}–${band.hi}`
      : level === 'warn'
        ? `${insertions} hand-written insertions exceed band ${band.lo}–${band.hi} — justify in the PR or re-cut`
        : `${insertions} hand-written insertions reach 2× band ${band.lo}–${band.hi} — stop and re-cut the slice`;
  return { insertions, level, message };
}

/**
 * @param {{path:string, content:string}[]} addedFiles  ADDED production source files
 * @returns {string[]} advisory mechanism-identifier hits `path (marker)`
 */
export function scanMechanisms(addedFiles) {
  const hits = [];
  for (const file of addedFiles) {
    if (!SOURCE_RE.test(file.path) || TEST_SOURCE_RE.test(file.path)) continue;
    const source = ts.createSourceFile(
      file.path,
      file.content ?? '',
      ts.ScriptTarget.Latest,
      false,
      file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    let marker = null;
    const visit = (node) => {
      if (marker !== null) return;
      if (ts.isIdentifier(node)) marker = MECHANISM_RE.exec(node.text)?.[1] ?? null;
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (marker !== null) hits.push(`${file.path} (${marker})`);
  }
  return hits;
}

function frontmatterValue(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/mu.exec(text ?? '')?.[1];
  if (!frontmatter) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*([^\\r\\n]*?)\\s*$`, 'mu').exec(frontmatter)?.[1] ?? null;
}

function sliceItemEntries(epicText) {
  return [...epicText.matchAll(/^(?:\d+\.|[-*])\s+`([^`]+)`\s+—\s+\*\*([^*]+)\*\*/gmu)].map(
    (match) => ({ item: match[1], slice: match[2] }),
  );
}

/** Every selected row maps once to a ready, reverse-linked item at pickup. */
export function validateSelectedSliceItems(epicText, selected, epicSlug, read) {
  const entries = sliceItemEntries(epicText);
  const violations = [];
  for (const slice of selected) {
    const matches = entries.filter((entry) => entry.slice === slice);
    if (matches.length !== 1) {
      violations.push(
        matches.length === 0
          ? `Budget slice "${slice}" has no Items mapping`
          : `Budget slice "${slice}" has ${matches.length} Items mappings`,
      );
      continue;
    }
    const path = `docs/backlog/${matches[0].item}.md`;
    const text = read(path);
    if (text === null) {
      violations.push(`${path} does not exist`);
    } else if (frontmatterValue(text, 'status') !== 'ready') {
      violations.push(`${path} is not ready`);
    } else if (frontmatterValue(text, 'epic') !== epicSlug) {
      violations.push(`${path} is not reverse-linked to epic ${epicSlug}`);
    }
  }
  return violations;
}

function parseList(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Single declarations plus legacy plural-form visibility for fail-closed routing. */
export function declaredBudgetSelection(env, readEvent) {
  if (env.RIFTY_BUDGET_SLICES !== undefined) {
    return { slices: parseList(env.RIFTY_BUDGET_SLICES), plural: true };
  }
  if (env.RIFTY_BUDGET_SLICE) {
    return { slices: [env.RIFTY_BUDGET_SLICE.trim()], plural: false };
  }
  if (!env.GITHUB_EVENT_PATH) return { slices: [], plural: false };
  try {
    const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
    const body = event?.pull_request?.body ?? '';
    const singles = [...body.matchAll(/^Budget-Slice:\s*([\w./-]+)\s*$/gmu)].map(
      (match) => match[1],
    );
    const plurals = [...body.matchAll(/^Budget-Slices:\s*(.+)\s*$/gmu)].flatMap((match) =>
      parseList(match[1]),
    );
    return { slices: [...singles, ...plurals], plural: plurals.length > 0 };
  } catch {
    return { slices: [], plural: false };
  }
}

/** Every selected Budget declaration from env or the GitHub PR body. */
export function declaredSlices(env, readEvent) {
  return declaredBudgetSelection(env, readEvent).slices;
}

/** Backward-compatible single declaration; null also means plural/ambiguous. */
export function declaredSlice(env, readEvent) {
  const selection = declaredBudgetSelection(env, readEvent);
  return !selection.plural && selection.slices.length === 1 ? selection.slices[0] : null;
}

/** Pair one slice with one exact goal, or identify a normal non-goal PR. */
export function validateRunDeclarations(sliceDeclarations, goalDeclarations, plural = false) {
  if (plural) return { error: 'Budget-Slices is unsupported; want exactly one Budget-Slice' };
  if (sliceDeclarations.length === 0 && goalDeclarations.length === 0) return { mode: 'normal' };
  if (sliceDeclarations.length !== 1) {
    return { error: `want exactly one Budget-Slice, got ${sliceDeclarations.length}` };
  }
  if (goalDeclarations.length !== 1) {
    return {
      error: `Budget-Slice requires exactly one Goal-Baseline, got ${goalDeclarations.length}`,
    };
  }
  const goal = parseGoalBaseline(goalDeclarations[0]);
  if (!goal) return { error: `malformed Goal-Baseline "${goalDeclarations[0]}"` };
  const match = /^([\w-]+)\/(.+)$/u.exec(sliceDeclarations[0]);
  if (!match) {
    return {
      error: `malformed Budget-Slice "${sliceDeclarations[0]}" (want <epic-slug>/<slice>)`,
    };
  }
  const [, epicSlug, slice] = match;
  if (epicSlug !== goal.epicSlug) {
    return { error: `slice epic ${epicSlug} does not match goal epic ${goal.epicSlug}` };
  }
  return {
    mode: 'goal',
    declaration: sliceDeclarations[0],
    epicSlug,
    slice,
    goal,
  };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const readEvent = (path) => readFileSync(path, 'utf8');
  const selection = declaredBudgetSelection(process.env, readEvent);
  const goals = declaredGoals(process.env, readEvent);
  const run = validateRunDeclarations(selection.slices, goals, selection.plural);
  if (run.mode === 'normal') {
    console.log('budget: OK — no autonomous goal declared');
    return;
  }
  if (run.error) {
    console.error(`budget: ✗ ${run.error}`);
    process.exit(1);
  }
  const { declaration, epicSlug, slice } = run;
  let mergeBase;
  try {
    mergeBase = git('merge-base', 'origin/main', 'HEAD').trim();
  } catch {
    console.error('budget: ✗ no origin/main merge-base; declared tripwire cannot be checked');
    process.exit(1);
  }
  const pickup = pickupCommit(mergeBase, git);
  const readAtPickup = (path) => {
    try {
      return git('show', `${pickup}:${path}`);
    } catch {
      return null;
    }
  };
  const epicPath = `docs/backlog/epics/${epicSlug}.md`;
  const epicText = readAtPickup(epicPath);
  if (epicText === null) {
    console.error(`budget: ✗ declared epic ${epicPath} not found at pickup ${pickup.slice(0, 12)}`);
    process.exit(1);
  }
  const budget = parseBudget(epicText);
  if (!budget || !budget.slices.has(slice)) {
    console.error(`budget: ✗ epic ${epicSlug} declared no pickup Budget slice "${slice}"`);
    process.exit(1);
  }
  const itemViolations = validateSelectedSliceItems(epicText, [slice], epicSlug, readAtPickup);
  if (itemViolations.length > 0) {
    console.error(
      `budget: ${itemViolations.length} invalid selected item(s) at pickup ${pickup.slice(0, 12)}:`,
    );
    for (const violation of itemViolations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  const numstat = git('diff', '-M', '--numstat', pickup)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, , ...rest] = line.split('\t');
      return { added: added === '-' ? null : Number(added), path: newPath(rest.join('\t')) };
    });
  const mass = evaluateMass(numstat, budget.slices.get(slice), budget.generated);
  const failures = [];
  if (mass.level === 'fail') failures.push(mass.message);
  else if (mass.level === 'warn') console.warn(`budget: ⚠ ${mass.message}`);
  if (budget.mechanismsZero && !budget.substrate) {
    const addedPaths = git('diff', '--name-status', pickup)
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('A'))
      .map((line) => line.split('\t').pop());
    const hits = scanMechanisms(
      addedPaths.map((path) => {
        try {
          return { path, content: readFileSync(path, 'utf8') };
        } catch {
          return { path, content: '' };
        }
      }),
    );
    if (hits.length > 0) {
      console.warn(
        `budget: ⚠ mechanism scan (advisory; review owns the full modified-file sweep): ${hits.join(', ')}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`budget: ${failures.length} violation(s) for ${declaration}:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(`budget: OK (${declaration}: ${mass.message})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
