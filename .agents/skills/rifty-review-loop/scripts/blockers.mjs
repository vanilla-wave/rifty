#!/usr/bin/env node
// Read a codex rifty-review verdict JSON, print a round summary, exit 1 if any blocker.
// Usage: node blockers.mjs <verdict.json>   (exit 0 = no blockers, 1 = blockers, 2 = unparseable)
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: blockers.mjs <verdict.json>');
  process.exit(2);
}

let v;
try {
  v = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`unparseable verdict (${path}): ${e.message}`);
  process.exit(2);
}

const axes = Array.isArray(v.axes) ? v.axes : [];
const findings = axes.flatMap((a) =>
  (Array.isArray(a.findings) ? a.findings : []).map((f) => ({ ...f, axis: a.axis })),
);
const blockers = findings.filter((f) => f.severity === 'blocker');
const concerns = findings.filter((f) => f.severity === 'concern');
const nits = findings.filter((f) => f.severity === 'nit');
const axisBlocker = axes.some((a) => a.verdict === 'blocker') || v.overall_verdict === 'blocker';
const hasBlocker = blockers.length > 0 || axisBlocker;

const line = (f) => `  - [${f.axis}] ${f.location || '?'} — ${f.summary || ''}`;
console.log(`overall: ${v.overall_verdict}  |  merge: ${v.merge_call || '?'}`);
console.log(`axes: ${axes.map((a) => `${a.axis}=${a.verdict}`).join(', ') || '(none)'}`);
console.log(`findings: ${blockers.length} blocker, ${concerns.length} concern, ${nits.length} nit`);
if (blockers.length) {
  console.log('BLOCKERS:');
  for (const f of blockers) {
    console.log(line(f));
  }
}
if (concerns.length) {
  console.log('CONCERNS:');
  for (const f of concerns) {
    console.log(line(f));
  }
}

process.exit(hasBlocker ? 1 : 0);
