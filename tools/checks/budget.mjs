#!/usr/bin/env node
/**
 * Budget tripwire (docs/backlog/README.md §Budget). An autonomous source PR
 * names one Goal-Baseline + Budget-Slice. Merge-base Budget is immutable;
 * Contract+RED may append the selected JIT row before pickup. Hand-written
 * insertions: > band warns, >= 2× fails. Mechanism detection is advisory.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { declaredGoals, historyHeadRevision, parseGoalBaseline } from './goal-contract.mjs';
import { PRODUCTION_SOURCE_RE as SOURCE_RE, pickupCommit } from './run-pickup.mjs';

const MECHANISM_RE = /\b(epoch|generation|fifo|ledger|lease|seenRequest\w*|opId)\b/i;
const TEST_SOURCE_RE =
  /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)|\.(?:test|spec|test-fixture|contract-fixtures)\.[^.]+$/u;
const BUDGET_SECTION_RE = /^## Budget[ \t]*(?:\r?\n|$)[\s\S]*?(?=^##[ \t]+|$(?![\s\S]))/mu;
const BUDGET_ROW_RE =
  /^\|\s*`?([\w./-]+)`?\s*\|\s*(\d[\d_]*)\s*[–-]\s*(\d[\d_]*)\s*\|[^\r\n]*(?:\r?\n)?$/u;

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

function budgetSection(epicText) {
  return BUDGET_SECTION_RE.exec(epicText ?? '')?.[0] ?? null;
}

function budgetLines(section) {
  return section?.match(/[^\r\n]*(?:\r\n|\n|$)/gu)?.filter(Boolean) ?? [];
}

function budgetRow(line) {
  const match = BUDGET_ROW_RE.exec(line);
  if (!match) return null;
  return { slice: match[1], lo: match[2], hi: match[3] };
}

/**
 * Parse an epic's `## Budget` section.
 * @returns {{slices: Map<string, {lo:number, hi:number}>, generated: RegExp[],
 *   mechanismsZero: boolean, substrate: string|null} | null}
 */
export function parseBudget(epicText) {
  const section = budgetSection(epicText);
  if (section === null) return null;
  const body = section.replace(/^## Budget[ \t]*(?:\r?\n|$)/u, '');
  const slices = new Map();
  for (const line of budgetLines(body)) {
    const row = budgetRow(line);
    if (row === null) continue;
    const [lo, hi] = [row.lo, row.hi].map((value) => Number(value.replace(/_/g, '')));
    if (row.slice !== 'slice' && Number.isFinite(lo) && Number.isFinite(hi)) {
      slices.set(row.slice, { lo, hi });
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
 * Freeze merge-base Budget bytes; Contract+RED may add only its selected row.
 * @returns {string[]} violations (empty = valid evolution)
 */
export function validateBudgetAuthority(baseEpicText, pickupEpicText, selectedSlice) {
  const base = budgetSection(baseEpicText);
  const pickup = budgetSection(pickupEpicText);
  if (base === null) return ['merge-base epic has no ## Budget authority'];
  if (pickup === null) return ['pickup epic removed ## Budget authority'];

  const baseRows = budgetLines(base).map(budgetRow).filter(Boolean);
  const pickupRows = budgetLines(pickup).map(budgetRow).filter(Boolean);
  const baseSlices = new Set(baseRows.map((row) => row.slice));
  const newRows = pickupRows.filter((row) => !baseSlices.has(row.slice));
  const violations = [];

  for (const [side, rows] of [
    ['merge-base', baseRows],
    ['pickup', pickupRows],
  ]) {
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.slice)) violations.push(`${side} duplicates Budget row "${row.slice}"`);
      seen.add(row.slice);
    }
  }
  if (newRows.length > 1) {
    violations.push(`pickup adds ${newRows.length} Budget rows; want at most one`);
  }
  for (const row of newRows) {
    if (row.slice !== selectedSlice) {
      violations.push(
        `pickup adds Budget row "${row.slice}" instead of selected slice "${selectedSlice}"`,
      );
    }
  }

  const fixedPickup = budgetLines(pickup)
    .filter((line) => {
      const row = budgetRow(line);
      return row === null || baseSlices.has(row.slice);
    })
    .join('');
  if (fixedPickup !== base) {
    violations.push('pickup rewrites merge-base Budget content or existing rows');
  }
  return violations;
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
  const historyHead = historyHeadRevision(process.env, readEvent);
  if (historyHead.error !== null) {
    console.error(`budget: ✗ ${historyHead.error}`);
    process.exit(1);
  }
  const head = historyHead.revision;
  let mergeBase;
  try {
    mergeBase = git('merge-base', 'origin/main', head).trim();
  } catch {
    console.error('budget: ✗ no origin/main merge-base; declared tripwire cannot be checked');
    process.exit(1);
  }
  const pickup = pickupCommit(mergeBase, git, head);
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
  let baseEpicText = null;
  try {
    baseEpicText = git('show', `${mergeBase}:${epicPath}`);
  } catch {
    /* reported by the authority validator */
  }
  const authorityViolations = validateBudgetAuthority(baseEpicText, epicText, slice);
  if (authorityViolations.length > 0) {
    console.error(
      `budget: ${authorityViolations.length} authority violation(s) from merge-base to pickup:`,
    );
    for (const violation of authorityViolations) console.error(`  ✗ ${violation}`);
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
  const numstat = git('diff', '-M', '--numstat', pickup, head)
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
