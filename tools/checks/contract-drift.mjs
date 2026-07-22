#!/usr/bin/env node
/**
 * Contract-drift tripwire (goal-drift axis; decision-workflow §Backlog
 * readiness). An implementation diff that ALSO rewords a ready contract is the
 * contract-level "never edit a test to make code pass" — the promise quietly
 * renarrated to fit the code. Adding a contract (Contract+RED lands with its
 * PR) and deleting one (delete-on-done closure) are normal flow; an IN-PLACE
 * edit of a `ready` item / `ready|in-progress` epic in the same diff as source
 * changes is not — split the re-refine into its own PR or record the
 * superseding decision first. Diff base = merge-base with origin/main; a
 * shallow clone without it skips loudly (the local pr:check gate still runs
 * it, CI lint job fetches full history).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const CONTRACT_RE = /^docs\/backlog\/.+\.md$/;
const SKIP_RE = /\/(?:README|TEMPLATE)\.md$/;
const GUARDED = new Set(['ready', 'in-progress']);

/** Frontmatter `status:` value, or null. */
export function statusOf(text) {
  const m = /^---[\s\S]*?^status:\s*(\S+)\s*$/m.exec(text ?? '');
  return m ? m[1] : null;
}

/**
 * @param {{status:string,path:string}[]} entries  git name-status rows
 * @param {(path:string, side:'base'|'head') => string|null} read
 * @returns {string[]} violations (empty = pass)
 */
export function evaluate(entries, read) {
  if (!entries.some((e) => SOURCE_RE.test(e.path))) return [];
  const violations = [];
  for (const e of entries) {
    if (e.status !== 'M' || !CONTRACT_RE.test(e.path) || SKIP_RE.test(e.path)) continue;
    const oldStatus = statusOf(read(e.path, 'base'));
    const newStatus = statusOf(read(e.path, 'head'));
    if (GUARDED.has(oldStatus) || GUARDED.has(newStatus)) {
      violations.push(
        `${e.path}: ready contract edited in-place (${oldStatus} → ${newStatus}) in the same diff as source changes — split the re-refine into its own PR or record the superseding decision first (goal-drift)`,
      );
    }
  }
  return violations;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  let base;
  try {
    base = git('merge-base', 'origin/main', 'HEAD').trim();
  } catch {
    console.log('contract-drift: SKIPPED — no origin/main merge-base (shallow clone?)');
    return;
  }
  const entries = git('diff', '--name-status', base)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
  const read = (path, side) => {
    try {
      return side === 'base' ? git('show', `${base}:${path}`) : readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  const violations = evaluate(entries, read);
  if (violations.length > 0) {
    console.error(`contract-drift: ${violations.length} violation(s) vs ${base.slice(0, 12)}:`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`contract-drift: OK (${entries.length} changed path(s) vs ${base.slice(0, 12)})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
