#!/usr/bin/env node
/**
 * Contract-authority tripwire. Contract+RED commits before pickup establish JIT
 * authority. Implementation cannot rewrite it; closure may only subtract exact
 * dependencies for deleted ready children. Process referees land separately.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SOURCE_RE as SOURCE_RE, pickupCommit } from './run-pickup.mjs';

const CONTRACT_RE = /^docs\/backlog\/.+\.md$/;
const SKIP_RE = /\/(?:README|TEMPLATE)\.md$/;
const GUARDED = new Set(['ready', 'in-progress']);
const ITEM_PATH_RE = /^docs\/backlog\/(?!epics\/)(.+)\.md$/;
const EPIC_PATH_RE = /^docs\/backlog\/epics\/[^/]+\.md$/;
const REFEREE_RE =
  /^(?:tools\/checks\/(?:(?:budget|contract-drift|goal-contract|run-pickup)(?:\.test)?\.(?:mjs|ts)|review-blockers\.test\.ts)|\.agents\/skills\/rifty-review-loop\/(?:review-schema\.json|scripts\/blockers\.mjs))$/;

/** Frontmatter `status:` value, or null. */
export function statusOf(text) {
  const match = /^---[\s\S]*?^status:\s*(\S+)\s*$/m.exec(text ?? '');
  return match ? match[1] : null;
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
 * @param {{status:string,path:string}[]} entries  post-pickup git name-status rows
 * @param {(path:string, side:'base'|'head') => string|null} read
 * @param {{status:string,path:string}[]} refereeEntries  full-PR rows
 * @returns {string[]} violations (empty = pass)
 */
export function evaluate(entries, read, refereeEntries = entries) {
  if (!entries.some((entry) => SOURCE_RE.test(entry.path))) return [];
  const refereeChanges = refereeEntries.filter((entry) => REFEREE_RE.test(entry.path));
  if (refereeChanges.length > 0) {
    return refereeChanges.map(
      (entry) =>
        `${entry.path}: implementation diff edits its own process referee — land gate semantics separately`,
    );
  }
  const closedItems = [];
  for (const entry of entries) {
    if (entry.status !== 'D') continue;
    const item = ITEM_PATH_RE.exec(entry.path)?.[1];
    if (!item) continue;
    const baseItem = read(entry.path, 'base');
    if (statusOf(baseItem) !== 'ready') continue;
    closedItems.push(item);
  }
  const violations = [];
  for (const entry of entries) {
    if (entry.status !== 'M' || !CONTRACT_RE.test(entry.path) || SKIP_RE.test(entry.path)) {
      continue;
    }
    const oldText = read(entry.path, 'base');
    const newText = read(entry.path, 'head');
    const oldStatus = statusOf(oldText);
    const newStatus = statusOf(newText);
    const epic = EPIC_PATH_RE.test(entry.path);
    if (!epic && oldStatus === 'ready' && newStatus === 'ready') {
      const closed = closeItemDependencies(oldText, closedItems);
      if (closed !== null && closed === newText) continue;
    }
    if (GUARDED.has(oldStatus) || GUARDED.has(newStatus)) {
      violations.push(
        `${entry.path}: ready contract edited in-place (${oldStatus} → ${newStatus}) beside source — split the contract-authority change`,
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
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  console.log(
    `contract-drift: OK (${entries.length} post-pickup path(s) vs ${pickup.slice(0, 12)})`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
