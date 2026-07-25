#!/usr/bin/env node
/**
 * Budget tripwire (docs/backlog/README.md §Budget). An epic's `## Budget`
 * declares named slices with hand-written diff bands. An autonomous source PR
 * names exactly one same-epic Goal-Baseline + Budget-Slice. Budget authority
 * is read at pickup (parent of first source commit), so a preceding Contract+RED
 * may add a JIT slice while later closure cannot erase/widen it. Hand-written
 * insertions: > band warns, >= 2× fails (re-cut). Added-file mechanism grep is
 * advisory only; review owns the honest modified-file sweep.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { declaredGoals, parseGoalBaseline } from './goal-contract.mjs';
import { PRODUCTION_SOURCE_RE as SOURCE_RE, pickupCommit } from './run-pickup.mjs';

const MECHANISM_RE = /\b(epoch|generation|fifo|ledger|lease|seenRequest\w*|opId)\b/i;

/** `a/{b => c}/d` and `a => b` numstat paths resolve to the new path. */
export function newPath(path) {
  const braced = path
    .replace(/\{([^{}]*) => ([^{}]*)\}/g, (_, _from, to) => to)
    .replace(/\/\//g, '/');
  const m = /^(.*) => (.*)$/.exec(braced);
  return m ? m[2] : braced;
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
    const [lo, hi] = [row[2], row[3]].map((n) => Number(n.replace(/_/g, '')));
    if (row[1] !== 'slice' && Number.isFinite(lo) && Number.isFinite(hi)) {
      slices.set(row[1], { lo, hi });
    }
  }
  const generated = [...body.matchAll(/^-\s*generated globs:\s*(.+)$/gim)].flatMap((m) =>
    [...m[1].matchAll(/`([^`]+)`/g)].map((g) => globToRegExp(g[1])),
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
    if (generated.some((re) => re.test(row.path))) continue;
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
 * @param {{path:string, content:string}[]} addedFiles  ADDED source files
 * @returns {string[]} advisory mechanism-marker hits `path (marker)`
 */
export function scanMechanisms(addedFiles) {
  const hits = [];
  for (const file of addedFiles) {
    if (!SOURCE_RE.test(file.path)) continue;
    const m = MECHANISM_RE.exec(file.content ?? '');
    if (m) hits.push(`${file.path} (${m[1]})`);
  }
  return hits;
}

/** Every Budget-Slice declaration from env or the GitHub PR body. */
export function declaredSlices(env, readEvent) {
  if (env.RIFTY_BUDGET_SLICE) return [env.RIFTY_BUDGET_SLICE.trim()];
  if (!env.GITHUB_EVENT_PATH) return [];
  try {
    const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
    const body = event?.pull_request?.body ?? '';
    return [...body.matchAll(/^Budget-Slice:\s*([\w./-]+)\s*$/gmu)].map((match) => match[1]);
  } catch {
    return [];
  }
}

/** Backward-compatible single declaration; null also means ambiguous plural. */
export function declaredSlice(env, readEvent) {
  const declarations = declaredSlices(env, readEvent);
  return declarations.length === 1 ? declarations[0] : null;
}

/** Pair one slice with one exact goal, or identify a normal non-goal PR. */
export function validateRunDeclarations(sliceDeclarations, goalDeclarations) {
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
  const declarations = declaredSlices(process.env, readEvent);
  const goals = declaredGoals(process.env, readEvent);
  const run = validateRunDeclarations(declarations, goals);
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
  let epicText;
  try {
    epicText = git('show', `${pickup}:docs/backlog/epics/${epicSlug}.md`);
  } catch {
    console.error(
      `budget: ✗ declared epic docs/backlog/epics/${epicSlug}.md not found at pickup ${pickup.slice(0, 12)}`,
    );
    process.exit(1);
  }
  const budget = parseBudget(epicText);
  if (!budget || !budget.slices.has(slice)) {
    console.error(`budget: ✗ epic ${epicSlug} declared no pickup Budget slice "${slice}"`);
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
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`budget: OK (${declaration}: ${mass.message})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
