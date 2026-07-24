#!/usr/bin/env node
/**
 * Budget tripwire (docs/backlog/README.md §Budget). An epic's `## Budget`
 * declares named slices with hand-written diff bands; a source PR names one
 * slice (`Budget-Slice`) or an explicitly requester-approved same-epic group
 * (`Budget-Slices` + `Budget-Reason`; task-scoped RIFTY_* equivalents locally).
 * Slice contracts are read at pickup (the diff base), so delete-on-done closure
 * in HEAD cannot erase validation authority. This check counts hand-written
 * insertions (numstat with rename detection, minus declared generated globs)
 * against the original band or their sum: > band warns, > 2× band fails
 * (stop-and-recut). If the budget pins `new coordination mechanisms: 0`, ADDED
 * production source files carrying mechanism-class identifiers
 * (fault-classes.md §Class-kill) fail unless the budget names a substrate item.
 * No declared slice = nothing to enforce (review's Budget axis owns undeclared
 * epic work).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const MECHANISM_RE = /\b(epoch|generation|fifo|ledger|lease|seenRequest\w*|opId)\b/i;
const TEST_SOURCE_RE = /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u;

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
  const level = insertions > 2 * band.hi ? 'fail' : insertions > band.hi ? 'warn' : 'ok';
  const message =
    level === 'ok'
      ? `${insertions} hand-written insertions within band ${band.lo}–${band.hi}`
      : level === 'warn'
        ? `${insertions} hand-written insertions exceed band ${band.lo}–${band.hi} — justify in the PR or re-cut`
        : `${insertions} hand-written insertions exceed 2× band ${band.lo}–${band.hi} — stop and re-cut the slice`;
  return { insertions, level, message };
}

/**
 * @param {{path:string, content:string}[]} addedFiles  ADDED production source files
 * @returns {string[]} mechanism-identifier hits `path (marker)`
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

/** Sum existing slice bands for one explicitly combined implementation run. */
export function combinedBand(slices, selected) {
  return selected.reduce(
    (total, name) => {
      const band = slices.get(name);
      if (!band) throw new Error(`unknown Budget slice "${name}"`);
      return { lo: total.lo + band.lo, hi: total.hi + band.hi };
    },
    { lo: 0, hi: 0 },
  );
}

function sliceItemEntries(epicText) {
  return [...epicText.matchAll(/^\d+\.\s+`([^`]+)`\s+—\s+\*\*([^*]+)\*\*/gmu)].map((match) => ({
    item: match[1],
    slice: match[2],
  }));
}

/** Every selected Budget row must map once to a ready item at pickup. */
export function validateSelectedSliceItems(epicText, selected, read) {
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
    } else if (!/^---[\s\S]*?^status:\s*ready\s*$/mu.test(text)) {
      violations.push(`${path} is not ready`);
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

/** Full single/combined Budget declaration from env or GitHub PR body. */
export function declaredRun(env, readEvent) {
  if (env.RIFTY_BUDGET_SLICES || env.RIFTY_BUDGET_SLICE) {
    return {
      slices: parseList(env.RIFTY_BUDGET_SLICES ?? env.RIFTY_BUDGET_SLICE),
      reason: env.RIFTY_BUDGET_REASON?.trim() || null,
    };
  }
  if (!env.GITHUB_EVENT_PATH) return null;
  try {
    const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
    const body = event?.pull_request?.body ?? '';
    const multiple = /^Budget-Slices:\s*(.+)\s*$/mu.exec(body)?.[1];
    const single = /^Budget-Slice:\s*([\w./-]+)\s*$/mu.exec(body)?.[1];
    const slices = multiple ? parseList(multiple) : single ? [single] : [];
    if (slices.length === 0) return null;
    return {
      slices,
      reason: /^Budget-Reason:\s*(.+)\s*$/mu.exec(body)?.[1]?.trim() || null,
    };
  } catch {
    return null;
  }
}

/** Backward-compatible single-slice view. */
export function declaredSlice(env, readEvent) {
  const run = declaredRun(env, readEvent);
  return run?.slices.length === 1 ? run.slices[0] : null;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const declaration = declaredRun(process.env, (p) => readFileSync(p, 'utf8'));
  if (!declaration) {
    console.log('budget: OK — no Budget-Slice declared');
    return;
  }
  if (declaration.slices.length === 0) {
    console.error('budget: ✗ empty Budget-Slices declaration');
    process.exit(1);
  }
  if (new Set(declaration.slices).size !== declaration.slices.length) {
    console.error('budget: ✗ Budget-Slices contains a duplicate declaration');
    process.exit(1);
  }
  if (declaration.slices.length > 1 && declaration.reason === null) {
    console.error('budget: ✗ combined slices require a non-empty Budget-Reason');
    process.exit(1);
  }
  const parsed = declaration.slices.map((value) => {
    const match = /^([\w-]+)\/(.+)$/.exec(value);
    if (!match) {
      console.error(`budget: ✗ malformed declaration "${value}" (want <epic-slug>/<slice>)`);
      process.exit(1);
    }
    return { epic: match[1], slice: match[2] };
  });
  const epicSlug = parsed[0].epic;
  if (parsed.some(({ epic }) => epic !== epicSlug)) {
    console.error('budget: ✗ one combined run cannot span multiple epics');
    process.exit(1);
  }
  const selected = parsed.map(({ slice }) => slice);
  let base;
  try {
    base = git('merge-base', 'origin/main', 'HEAD').trim();
  } catch {
    console.log('budget: SKIPPED — no origin/main merge-base (shallow clone?)');
    return;
  }
  const readAtPickup = (path) => {
    try {
      return git('show', `${base}:${path}`);
    } catch {
      return null;
    }
  };
  const epicPath = `docs/backlog/epics/${epicSlug}.md`;
  const epicText = readAtPickup(epicPath);
  if (epicText === null) {
    console.error(
      `budget: ✗ declared epic ${epicPath} did not exist at pickup ${base.slice(0, 12)}`,
    );
    process.exit(1);
  }
  const budget = parseBudget(epicText);
  const unknown = selected.find((slice) => !budget?.slices.has(slice));
  if (!budget || unknown) {
    console.error(`budget: ✗ epic ${epicSlug} declares no Budget slice "${unknown}"`);
    process.exit(1);
  }
  const itemViolations = validateSelectedSliceItems(epicText, selected, readAtPickup);
  if (itemViolations.length > 0) {
    console.error(
      `budget: ${itemViolations.length} invalid selected item(s) at pickup ${base.slice(0, 12)}:`,
    );
    for (const violation of itemViolations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  const numstat = git('diff', '-M', '--numstat', base)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, , ...rest] = line.split('\t');
      return { added: added === '-' ? null : Number(added), path: newPath(rest.join('\t')) };
    });
  const mass = evaluateMass(numstat, combinedBand(budget.slices, selected), budget.generated);
  const failures = [];
  if (mass.level === 'fail') failures.push(mass.message);
  else if (mass.level === 'warn') console.warn(`budget: ⚠ ${mass.message}`);
  if (budget.mechanismsZero) {
    const addedPaths = git('diff', '--name-status', base)
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
    if (hits.length > 0 && !budget.substrate) {
      failures.push(
        `new coordination mechanisms: 0 declared, but added production source files carry mechanism-class identifiers (fault-classes.md §Class-kill): ${hits.join(', ')} — consolidate into an existing owner or name the substrate item in the epic Budget`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`budget: ${failures.length} violation(s) for ${declaration.slices.join(', ')}:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`budget: OK (${declaration.slices.join(', ')}: ${mass.message})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
