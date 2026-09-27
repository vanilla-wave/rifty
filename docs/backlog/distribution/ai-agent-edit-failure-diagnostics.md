---
area: distribution
status: draft
title: Make a failing edit_file match name the match count, lines and closest candidate without applying anything or matching fuzzily
created: 2026-09-27
why: Weak models loop on "string not found" / "not unique" because the result carries nothing to correct with; a precise failure reason is the most cited weak-model fix and keeps exact matching.
user_story: As a developer watching the agent edit on a weak model, I want a failed edit to tell the model where the matches are or which line is closest, but today it says only `edit_file: string not found in <path>`.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-weak-model-baseline-lane]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0424-headless-pi-agent-over-public-project-hosts.md]
code: [packages/agent/src/tools.ts, packages/agent/src/apply-patch.ts]
---

## Context

finding — goal slice 8 (I7); after slice 4 (baseline before mechanisms).

- Ours: `tools.ts:169,171` `edit_file: string not found in <path>` /
  `edit_file: string is not unique in <path>`. `apply_patch` already reports
  hunk-level detail — `apply-patch.ts:216-221` "hunk <header> does not match
  the current content of <path>" / "matches N positions — ambiguous" — and its
  write-stage failure (`tools.ts:208`) reports applied files per ADR-0424 §7;
  both stay as they are (critic findings 2 and 8).
- Evidence (§Research): search/replace failures are anchor ambiguity;
  malformed edits must fail with a precise reason; DeepSeek Flash loops on
  edit failures without recovery.
- After this slice: `edit_file` with several matches → nothing written,
  result lists the count and the line of each match (capped, e.g. 10);
  zero matches → the closest line by whitespace-insensitive comparison,
  marked as a hint (never applied); all inside the 16 KiB cap; matching stays
  exact.
- Carrier notes for PICKUP: the diagnostic is computed from the same file
  content the transform read (Workbench CAS version / sandbox read), so the
  hint cannot describe a newer file; unit tests over edit_file cases; the
  bench counts edit failures per run (slice 4 column).

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (rejected route "fuzzy matching", tier).
