#!/usr/bin/env node
/**
 * Budget tripwire (docs/backlog/README.md §Budget). An epic's `## Budget`
 * declares named slices with hand-written diff bands; a source PR names its
 * slice (`Budget-Slice: <epic-slug>/<slice>` in the PR body, or
 * RIFTY_BUDGET_SLICE locally); this check counts hand-written insertions
 * (numstat with rename detection, minus the epic's declared generated globs)
 * against the band: > band warns, > 2× band fails (stop-and-recut). If the
 * budget pins `new coordination mechanisms: 0`, ADDED source files matching
 * mechanism-class markers (fault-classes.md §Class-kill) fail unless the
 * budget names a substrate item. No declared slice = nothing to enforce
 * (review's Budget axis owns undeclared epic work).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
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
 * @param {{path:string, content:string}[]} addedFiles  ADDED source files
 * @returns {string[]} mechanism-marker hits `path (marker)`
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

/** `Budget-Slice: <epic>/<slice>` from env or the GitHub event PR body. */
export function declaredSlice(env, readEvent) {
  if (env.RIFTY_BUDGET_SLICE) return env.RIFTY_BUDGET_SLICE.trim();
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
      const body = event?.pull_request?.body ?? '';
      const m = /^Budget-Slice:\s*([\w./-]+)\s*$/m.exec(body);
      if (m) return m[1];
    } catch {
      /* no event or malformed — fall through to undeclared */
    }
  }
  return null;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const declaration = declaredSlice(process.env, (p) => readFileSync(p, 'utf8'));
  if (!declaration) {
    console.log('budget: OK — no Budget-Slice declared');
    return;
  }
  const m = /^([\w-]+)\/(.+)$/.exec(declaration);
  if (!m) {
    console.error(`budget: ✗ malformed declaration "${declaration}" (want <epic-slug>/<slice>)`);
    process.exit(1);
  }
  const [, epicSlug, slice] = m;
  let epicText;
  try {
    epicText = readFileSync(`docs/backlog/epics/${epicSlug}.md`, 'utf8');
  } catch {
    console.error(`budget: ✗ declared epic docs/backlog/epics/${epicSlug}.md not found`);
    process.exit(1);
  }
  const budget = parseBudget(epicText);
  if (!budget || !budget.slices.has(slice)) {
    console.error(`budget: ✗ epic ${epicSlug} declares no Budget slice "${slice}"`);
    process.exit(1);
  }
  let base;
  try {
    base = git('merge-base', 'origin/main', 'HEAD').trim();
  } catch {
    console.log('budget: SKIPPED — no origin/main merge-base (shallow clone?)');
    return;
  }
  const numstat = git('diff', '-M', '--numstat', base)
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
    if (hits.length > 0) {
      failures.push(
        `new coordination mechanisms: 0 declared, but added source files carry mechanism-class markers (fault-classes.md §Class-kill): ${hits.join(', ')} — consolidate into an existing owner or name the substrate item in the epic Budget`,
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
