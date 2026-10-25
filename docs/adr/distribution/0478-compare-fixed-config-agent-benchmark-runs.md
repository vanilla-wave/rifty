# ADR 0478: Compare fixed-config agent benchmark runs

Status: Accepted
Date: 2026-09

> TL;DR: Compare complete matching report rows; preserve negative deltas and all measured evidence.

## Context

Goal I13 requires the frozen Luna baseline repeated after I5–I11, with no task
regression. Existing reports already identify task/lane/run and record metrics.
The later quality goal owns broader reporting; no second runner/judge is needed.

## Decision

- Add `report <current-dir> --compare <baseline-dir>`; emit comparison.json/md
  alongside the current ordinary report. Baseline files remain untouched.
- Validate equal endpoint/limits/taskSet/declared run count and exact matching
  task/lane/run identities, no duplicates or incomplete groups. Profiles and
  source revisions may differ: that is the measured mechanism change.
- Each task/lane row retains before/after/delta for pass, budget/context outcomes,
  token totals, median duration/tools and mechanism/failure counters. Three-run
  ±1-pass deltas carry a noise label; a negative row still reports regression.
  No other row can offset it. Machine output lists regressions; CLI exits1 after
  writing valid comparison artifacts when any exist. Incompatible input fails
  before producing comparison artifacts.
- Formal I13 keeps the exact five tasks, supported lanes, three cold runs and
  config (42 total). Record clean revision, originals, source snapshots, hashes,
  manual failure classes. No replacement agent runs or altered tasks/judges.

## Consequences

Small pure report reducer plus existing CLI. Counts/identities prove comparability;
source/artifact review proves measurement provenance. This finite sample is not a
causal isolation of host effects (ADR0434 caveat remains). Later report owner
absorbs the comparison; no independent framework or scoring model.
