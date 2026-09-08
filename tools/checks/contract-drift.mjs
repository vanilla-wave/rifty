#!/usr/bin/env node
// Scope changes need an explicit record; PR packaging and document lifecycle are not gates.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  goalContract,
  itemContract,
  statusOf,
  tracedRows,
  userTracedRowCount,
} from '../review/contract.mjs';
export {
  goalContract,
  itemContract,
  statusOf,
  tracedRowCount,
  userTracedRowCount,
} from '../review/contract.mjs';

const EXACT_SHA_RE = /^[0-9a-f]{40}$/u;

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

const GUARDED = new Set(['ready', 'in-progress']);
const GOAL_RE = /^docs\/backlog\/epics\/(?:[^/]+\.md|[^/]+\/goal\.md)$/u;
const ITEM_RE = /^docs\/backlog\/(?!epics\/)[^/]+\/(?!README\.md$|TEMPLATE\.md$)[^/]+\.md$/u;
const RECORD_RE = /^(?:[-*]\s+)?`?(?:re-cut|amend): \d{4}-\d{2}-\d{2} — .+$/gmu;

function newRecords(base, head) {
  const old = new Set((base ?? '').match(RECORD_RE) ?? []);
  return ((head ?? '').match(RECORD_RE) ?? []).filter((line) => !old.has(line));
}

/** Records prove attribution, not authorization: independent review checks the user's words. */
export function evaluate(entries, read) {
  const violations = [];
  for (const { path, status } of entries) {
    if (status === 'D' || (!GOAL_RE.test(path) && !ITEM_RE.test(path))) continue;
    const base = read(path, 'base');
    const head = read(path, 'head');
    if (head === null || !GUARDED.has(statusOf(base))) continue;
    const records = newRecords(base, head);
    if (GOAL_RE.test(path)) {
      if (
        JSON.stringify(goalContract(base)) !== JSON.stringify(goalContract(head)) &&
        !records.some((line) => /amend:.*— user: \S/u.test(line))
      ) {
        violations.push(`${path}: goal changed without a recorded user amendment (RDY-6)`);
      }
      continue;
    }
    if (!GUARDED.has(statusOf(head)) || itemContract(base) === itemContract(head)) continue;
    const recuts = records.filter((line) => /re-cut:/u.test(line));
    if (recuts.length === 0) {
      violations.push(`${path}: ready contract changed without a re-cut line (RDY-5)`);
      continue;
    }
    if (
      userTracedRowCount(head) < userTracedRowCount(base) &&
      !recuts.some((line) => /— fork:/u.test(line))
    ) {
      violations.push(`${path}: user-traced row dropped without a recorded fork (RDY-5)`);
    }
    const adrIds = (text) =>
      new Set(tracedRows(text).flatMap((row) => row.match(/ADR-\d{4}/gu) ?? []));
    const remaining = adrIds(head);
    for (const id of adrIds(base)) {
      if (!remaining.has(id) && !recuts.some((line) => line.includes(id))) {
        violations.push(
          `${path}: ${id}-traced row dropped without ${id} named in the re-cut line (RDY-5)`,
        );
      }
    }
  }
  return violations;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const historyHead = historyHeadRevision(process.env, (path) => readFileSync(path, 'utf8'));
  if (historyHead.error !== null) {
    console.error(`contract-drift: ✗ ${historyHead.error}`);
    process.exit(1);
  }
  const head = historyHead.revision;
  let base;
  try {
    base = git('merge-base', 'origin/main', head).trim();
  } catch {
    console.log('contract-drift: SKIPPED — no origin/main merge-base (shallow clone?)');
    return;
  }
  const entries = git('diff', '--name-status', base, head)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
  const read = (path, side) => {
    try {
      if (side === 'base') return git('show', `${base}:${path}`);
      return head === 'HEAD' ? readFileSync(path, 'utf8') : git('show', `${head}:${path}`);
    } catch {
      return null;
    }
  };
  const violations = evaluate(entries, read);
  if (violations.length > 0) {
    console.error(`contract-drift: ${violations.length} violation(s) vs ${base.slice(0, 12)}:`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  console.log(`contract-drift: OK (${entries.length} path(s) vs ${base.slice(0, 12)})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
