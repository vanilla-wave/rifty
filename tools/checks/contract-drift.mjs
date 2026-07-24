#!/usr/bin/env node
/**
 * Contract-drift tripwire (goal-drift axis; decision-workflow §Backlog
 * readiness). An implementation diff that ALSO rewords a ready contract is the
 * contract-level "never edit a test to make code pass" — the promise quietly
 * renarrated to fit the code. Adding a contract (Contract+RED lands with its
 * PR) and deleting one (delete-on-done closure) are normal flow; an IN-PLACE
 * edit of a `ready` item / `ready|in-progress` epic in the same diff as source
 * changes is not — split the re-refine into its own PR or record the
 * superseding decision first. Deleting a ready item may subtract only its
 * exact epic/dependency bookkeeping; every other ready-contract mutation
 * remains guarded. Diff base = merge-base with origin/main; a shallow clone
 * without it skips loudly (the local pr:check gate still runs it, CI lint job
 * fetches full history).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_RE = /^(?:apps|packages|services)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const CONTRACT_RE = /^docs\/backlog\/.+\.md$/;
const SKIP_RE = /\/(?:README|TEMPLATE)\.md$/;
const GUARDED = new Set(['ready', 'in-progress']);
const ITEM_PATH_RE = /^docs\/backlog\/(?!epics\/)(.+)\.md$/;
const EPIC_PATH_RE = /^docs\/backlog\/epics\/([^/]+)\.md$/;

/** Frontmatter `status:` value, or null. */
export function statusOf(text) {
  const m = /^---[\s\S]*?^status:\s*(\S+)\s*$/m.exec(text ?? '');
  return m ? m[1] : null;
}

/** Scalar frontmatter value, or null. */
function frontmatterValue(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/m.exec(text ?? '')?.[1];
  if (!frontmatter) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*([^\\r\\n]+?)\\s*$`, 'm').exec(frontmatter)?.[1] ?? null;
}

/**
 * Produce the one permitted guarded-epic closure edit, or null when the base
 * bookkeeping does not map every deleted child exactly once.
 */
export function closeEpicItems(epicText, deletedItems) {
  if (deletedItems.length === 0) return null;
  const deleted = new Set(deletedItems);
  if (deleted.size !== deletedItems.length) return null;

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

  const mappings = [...epicText.matchAll(/^\d+\.\s+`([^`]+)`\s+—\s+\*\*([^*]+)\*\*/gmu)].map(
    (match) => ({ item: match[1], slice: match[2] }),
  );
  const slices = new Set();
  for (const item of deletedItems) {
    const matches = mappings.filter((mapping) => mapping.item === item);
    if (matches.length !== 1) return null;
    slices.add(matches[0].slice);
  }
  if (slices.size !== deletedItems.length) return null;

  const hasBudget = /^## Budget\s*$/mu.test(epicText);
  if (hasBudget) {
    for (const slice of slices) {
      const rows = [
        ...epicText.matchAll(/^\|\s*([^|]+?)\s*\|\s*\d[\d_]*\s*[–-]\s*\d[\d_]*\s*\|\s*$/gmu),
      ].filter((match) => match[1].trim() === slice);
      if (rows.length !== 1) return null;
    }
  }

  const remainingItems = frontmatterItems.filter((item) => !deleted.has(item));
  const lines = epicText.replace(itemLine[0], `items: [${remainingItems.join(', ')}]`).split('\n');
  const output = [];
  let inItemsSection = false;
  let skippingItem = false;
  for (const line of lines) {
    if (/^## Items\s*$/.test(line)) {
      inItemsSection = true;
      skippingItem = false;
      output.push(line);
      continue;
    }
    if (inItemsSection && /^## /.test(line)) {
      inItemsSection = false;
      skippingItem = false;
    }
    if (inItemsSection) {
      const mapping = /^\d+\.\s+`([^`]+)`\s+—\s+\*\*([^*]+)\*\*/u.exec(line);
      if (mapping) {
        skippingItem = deleted.has(mapping[1]);
        if (!skippingItem) output.push(line);
        continue;
      }
      if (skippingItem) continue;
    }
    const budgetRow = /^\|\s*([^|]+?)\s*\|\s*\d[\d_]*\s*[–-]\s*\d[\d_]*\s*\|\s*$/u.exec(line);
    if (budgetRow && slices.has(budgetRow[1].trim())) continue;
    output.push(line);
  }
  return output.join('\n');
}

/** Remove only deleted ready-item keys from one dependent's blocked_by list. */
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
export function evaluate(entries, read) {
  if (!entries.some((e) => SOURCE_RE.test(e.path))) return [];
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
    const items = closedByEpic.get(epic) ?? [];
    items.push(item);
    closedByEpic.set(epic, items);
  }
  const violations = [];
  for (const e of entries) {
    if (e.status !== 'M' || !CONTRACT_RE.test(e.path) || SKIP_RE.test(e.path)) continue;
    const oldText = read(e.path, 'base');
    const newText = read(e.path, 'head');
    const oldStatus = statusOf(oldText);
    const newStatus = statusOf(newText);
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
