#!/usr/bin/env node
/**
 * Contract-drift tripwire (goal-drift axis; decision-workflow §Backlog
 * readiness). An implementation diff that ALSO rewords a ready contract is the
 * contract-level "never edit a test to make code pass". Adding a contract and
 * delete-on-done are normal. Contract+RED commits before pickup establish JIT
 * authority; after pickup, guarded contracts permit only exact frontmatter /
 * dependency subtraction for deleted ready children. Referee semantics always
 * land in process-only PRs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SOURCE_RE as SOURCE_RE, pickupCommit } from './run-pickup.mjs';

const CONTRACT_RE = /^docs\/backlog\/.+\.md$/;
const SKIP_RE = /\/(?:README|TEMPLATE)\.md$/;
const GUARDED = new Set(['ready', 'in-progress']);
const ITEM_PATH_RE = /^docs\/backlog\/(?!epics\/)(.+)\.md$/;
const EPIC_PATH_RE = /^docs\/backlog\/epics\/([^/]+)\.md$/;
const REFEREE_RE =
  /^(?:tools\/checks\/(?:(?:budget|contract-drift|goal-contract|run-pickup)(?:\.test)?\.(?:mjs|ts)|review-blockers\.test\.ts)|\.agents\/skills\/rifty-review-loop\/(?:review-schema\.json|scripts\/blockers\.mjs))$/;

/** Frontmatter `status:` value, or null. */
export function statusOf(text) {
  const m = /^---[\s\S]*?^status:\s*(\S+)\s*$/m.exec(text ?? '');
  return m ? m[1] : null;
}

function frontmatterValue(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/m.exec(text ?? '')?.[1];
  if (!frontmatter) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*([^\\r\\n]+?)\\s*$`, 'm').exec(frontmatter)?.[1] ?? null;
}

/** The one permitted epic edit: remove exact closed keys from frontmatter. */
export function closeEpicItems(epicText, deletedItems) {
  if (deletedItems.length === 0 || new Set(deletedItems).size !== deletedItems.length) return null;
  const deleted = new Set(deletedItems);
  const itemLine = /^items:\s*\[([^\]]*)\]\s*$/m.exec(epicText);
  if (!itemLine) return null;
  const frontmatterItems = itemLine[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    deletedItems.some(
      (item) => frontmatterItems.filter((candidate) => candidate === item).length !== 1,
    )
  ) {
    return null;
  }
  const remainingItems = frontmatterItems.filter((item) => !deleted.has(item));
  return epicText.replace(itemLine[0], `items: [${remainingItems.join(', ')}]`);
}

/** Remove only deleted ready-item keys from a dependent's blocked_by list. */
export function closeItemDependencies(itemText, deletedItems) {
  if (deletedItems.length === 0) return null;
  const closed = new Set(deletedItems);
  const line = /^blocked_by:\s*\[([^\]]*)\]\s*\r?\n?/m.exec(itemText);
  if (!line) return null;
  const dependencies = line[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const remaining = dependencies.filter((dependency) => !closed.has(dependency));
  if (remaining.length === dependencies.length) return null;
  const replacement = remaining.length > 0 ? `blocked_by: [${remaining.join(', ')}]\n` : '';
  return itemText.replace(line[0], replacement);
}

/**
 * @param {{status:string,path:string}[]} entries  git name-status rows
 * @param {(path:string, side:'base'|'head') => string|null} read
 * @returns {string[]} violations (empty = pass)
 */
export function evaluate(entries, read, refereeEntries = entries) {
  if (!entries.some((e) => SOURCE_RE.test(e.path))) return [];
  const refereeChanges = refereeEntries.filter((entry) => REFEREE_RE.test(entry.path));
  if (refereeChanges.length > 0) {
    return refereeChanges.map(
      (entry) =>
        `${entry.path}: implementation diff edits its own process referee — land gate semantics separately`,
    );
  }
  const closedByEpic = new Map();
  const closedItems = [];
  for (const entry of entries) {
    if (entry.status !== 'D') continue;
    const item = ITEM_PATH_RE.exec(entry.path)?.[1];
    if (!item) continue;
    const baseItem = read(entry.path, 'base');
    if (statusOf(baseItem) !== 'ready') continue;
    closedItems.push(item);
    const epic = frontmatterValue(baseItem, 'epic');
    if (!epic) continue;
    const children = closedByEpic.get(epic) ?? [];
    children.push(item);
    closedByEpic.set(epic, children);
  }
  const violations = [];
  for (const e of entries) {
    if (e.status !== 'M' || !CONTRACT_RE.test(e.path) || SKIP_RE.test(e.path)) continue;
    const oldStatus = statusOf(read(e.path, 'base'));
    const newStatus = statusOf(read(e.path, 'head'));
    const oldText = read(e.path, 'base');
    const newText = read(e.path, 'head');
    const epic = EPIC_PATH_RE.exec(e.path)?.[1];
    if (epic && GUARDED.has(oldStatus) && newStatus === oldStatus) {
      const closed = closeEpicItems(oldText, closedByEpic.get(epic) ?? []);
      if (closed !== null && closed === newText) continue;
    }
    if (!epic && oldStatus === 'ready' && newStatus === 'ready') {
      const closed = closeItemDependencies(oldText, closedItems);
      if (closed !== null && closed === newText) continue;
    }
    if (GUARDED.has(oldStatus) || GUARDED.has(newStatus)) {
      violations.push(
        `${e.path}: ready contract edited in-place (${oldStatus} → ${newStatus}) beside source — split the contract change; an implementer cannot rewrite the goal (goal-drift)`,
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
  const pickup = pickupCommit(base, git);
  const parseEntries = (text) =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return { status: parts[0][0], path: parts[parts.length - 1] };
      });
  const fullEntries = parseEntries(git('diff', '--name-status', base));
  const entries = parseEntries(git('diff', '--name-status', pickup));
  const read = (path, side) => {
    try {
      return side === 'base' ? git('show', `${pickup}:${path}`) : readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  const violations = evaluate(entries, read, fullEntries);
  if (violations.length > 0) {
    console.error(`contract-drift: ${violations.length} violation(s) vs ${pickup.slice(0, 12)}:`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(
    `contract-drift: OK (${entries.length} post-pickup path(s) vs ${pickup.slice(0, 12)})`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
