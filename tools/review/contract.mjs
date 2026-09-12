// Shared contract projection: review coverage, scope changes, and PASS binding.
function frontmatterValue(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/mu.exec(text ?? '')?.[1];
  if (!frontmatter) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*([^\\r\\n]*?)\\s*$`, 'mu').exec(frontmatter)?.[1] ?? null;
}

export function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^##\\s+${escaped}\\s*$\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, 'mu')
      .exec(text ?? '')?.[1]
      ?.trim() ?? null
  );
}

/** Canonical observable part of a ready epic (legacy single-file format). */
export function goalContract(text) {
  if (text === null || text === undefined) return null;
  return {
    value: frontmatterValue(text, 'value'),
    tier: frontmatterValue(text, 'tier'),
    outcome: section(text, 'Outcome'),
    userScenario: section(text, 'User scenario'),
    invariants: section(text, 'Invariants'),
  };
}

const SECTIONS = [
  'User scenario',
  'Reference contract',
  'Acceptance',
  'Parity cases',
  'Fault matrix',
  'Out of scope',
];

export function statusOf(text) {
  return frontmatterValue(text, 'status');
}

export function itemContract(text) {
  return text == null ? null : SECTIONS.map((name) => section(text, name)).join('\u0000');
}

export function tracedRows(text) {
  return SECTIONS.flatMap((name) => (section(text, name) ?? '').split(/\r?\n/)).filter((line) =>
    /^(?:\d+\.|[-*]|\|).*→\s*(?:I\d+|scenario|ADR-\d{4})\b/u.test(line.trim()),
  );
}

export function tracedRowCount(text) {
  return tracedRows(text).length;
}

export function userTracedRowCount(text) {
  return tracedRows(text).filter((line) => /→\s*(?:I\d+|scenario)\b/u.test(line)).length;
}

/** All graded content, including a goal's outcome/invariants/tier. History is excluded. */
export function reviewContract(text) {
  return text == null
    ? null
    : JSON.stringify({ item: itemContract(text), goal: goalContract(text) });
}
