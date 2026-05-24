#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Collect lines matching a pattern under the given roots, honouring include globs.
 */
function grep(pattern, roots, includes) {
  const args = ['-r'];
  for (const inc of includes) args.push(`--include=${inc}`);
  args.push(pattern, ...roots);
  try {
    return execFileSync('grep', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// --- Existing behaviour: list TODO(ADR) markers across the whole tree. -----

const todoLines = grep('TODO(ADR):', ['.'], ['*.ts', '*.tsx', '*.js', '*.mjs', '*.md']);
console.log(`TODO(ADR) markers in repo: ${todoLines.length}`);
for (const line of todoLines) console.log(`  ${line}`);

// --- New behaviour: check active OPEN_QUESTIONS entries have markers. ------

const QID_RE = /Q-\d{4}-\d{2}-\d{3}/g; // not used directly, see below
const ACTIVE_ID_RE = /^## (Q-\d{4}-\d{2}-\d{2}-\d{3}):/gm;

let openQuestions;
try {
  openQuestions = readFileSync('OPEN_QUESTIONS.md', 'utf8');
} catch {
  console.error('todo-report: cannot read OPEN_QUESTIONS.md');
  process.exit(2);
}

// Slice out the "## Active" section: from the first "## Active" heading to the
// next top-level section divider followed by "## Template" / "## Promoted" /
// "## Rejected". A simple approach: take from "## Active" up to the first
// "\n## Template" / "\n## Promoted" / "\n## Rejected" marker.
function sliceActiveSection(md) {
  const start = md.indexOf('## Active');
  if (start === -1) return '';
  const rest = md.slice(start);
  const terminators = ['\n## Template', '\n## Promoted', '\n## Rejected'];
  let end = rest.length;
  for (const t of terminators) {
    const i = rest.indexOf(t);
    if (i !== -1 && i < end) end = i;
  }
  return rest.slice(0, end);
}

const activeSection = sliceActiveSection(openQuestions);
const activeIds = [];
for (const match of activeSection.matchAll(ACTIVE_ID_RE)) {
  activeIds.push(match[1]);
}

// An entry may explicitly say it's pre-implementation by listing
// "(none — …)" or "(none, …)" under its "### Code markers" subsection. Skip
// such entries from the must-have-markers check — they're documenting a
// decision that doesn't yet touch the code.
function isPreImplementation(md, qid) {
  const idx = md.indexOf(`## ${qid}`);
  if (idx === -1) return false;
  const entry = md.slice(idx, idx + 4000); // crude bound
  const cm = entry.indexOf('### Code markers');
  if (cm === -1) return false;
  const cmBody = entry.slice(cm, cm + 400);
  return /\(\s*none\b/i.test(cmBody);
}

console.log('');
console.log(`Active OPEN_QUESTIONS entries: ${activeIds.length}`);

const missing = [];
for (const qid of activeIds) {
  // Search the relevant source roots only (exclude OPEN_QUESTIONS.md itself).
  const hits = grep(
    qid,
    ['packages', 'apps', 'tools'],
    ['*.ts', '*.tsx', '*.mjs', '*.json', '*.md'],
  ).filter((line) => !line.includes('OPEN_QUESTIONS.md'));
  const preImpl = isPreImplementation(openQuestions, qid);
  const tag = preImpl ? ' (pre-implementation)' : '';
  console.log(`  ${qid}: ${hits.length} marker(s)${tag}`);
  if (hits.length === 0 && !preImpl) missing.push(qid);
}

if (missing.length > 0) {
  console.error('');
  console.error(
    `todo-report: ${missing.length} active OPEN_QUESTIONS entr${missing.length === 1 ? 'y has' : 'ies have'} zero markers in code:`,
  );
  for (const qid of missing) console.error(`  - ${qid}`);
  console.error(
    'Either add a `// TODO(ADR): <id>` marker at the affected code site, ' +
      'or move the entry to the Rejected/Promoted section of OPEN_QUESTIONS.md.',
  );
  process.exit(1);
}
