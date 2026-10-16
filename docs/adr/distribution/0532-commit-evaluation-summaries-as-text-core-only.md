# ADR 0532: Commit evaluation summaries as text core only

Status: Accepted
Date: 2026-10

> TL;DR: a committed `tools/agent-bench/reports/summaries/<run>/` carries `report.json.gz`, `statistics.json.gz`, `summary.md`, `README.md` (and small PNG screens); browser traces, split binary parts, workspace archives and frozen bundles stay in the local run directory. Details beyond the text core come from a fresh run, never from git.

## Context

ADR-0434 captures a real Playwright trace per attempt (`browser.zip`, screenshots on);
ADR-0505 retains every attempt's evidence in the run directory. PR #341 extended
"retain" to "commit": 18 campaigns, 1934 files, 3.6 GiB of traces/parts under
`reports/summaries/` plus 1.2 GiB of proof archives under the backlog reference directories
— 3.9 GiB on a ~1 GiB `main`, paid by every clone and CI checkout. The agent event
trace for 96 attempts is 50 MiB; the Playwright screenshot stream was the bulk. No
code reads `browser.zip`; humans opened it twice for `pageerror` text.

## Decision

1. Committed summaries = text core: `report.json.gz` (producer report, immutable),
   `statistics.json.gz`, `summary.md`, `README.md`; PNG screens allowed. No `.zip`,
   `.part-NN`, `browser.*`; no file above 8 MiB (`summaries-policy.test.ts` guard).
2. `summary.md` regenerates offline from `report.json.gz`; artifact paths it cannot
   resolve render as `(not local)`. Producer-recorded artifact paths in the report
   stay as recorded — they describe the run, not the repository.
3. Run directories keep full evidence locally (ADR-0434/0505 unchanged). Historical
   campaigns keep nothing in git beyond their mention in the current reference README.
4. Verdict/proof records under the backlog `reference/` directories follow the same rule:
   JSON verdicts and Markdown only; binary proof archives are not committed.

## Consequences

- `main` stays clonable; CI checkouts do not carry campaign archives.
- Post-hoc visual replay of a committed campaign is impossible; the structured agent
  trace, judge probes, `screen.png` and textual `pageerror` capture must suffice —
  `docs/backlog/distribution/agent-bench-browser-trace-opt-in.md` makes the trace opt-in.
- The eval-v18 result is a frozen recording of numbers and classifications; anyone who
  needs attempt-level detail runs a new series with the retained corpus/config.
