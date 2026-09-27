---
area: distribution
status: draft
title: Append the Workbench diagnostics for changed files to every successful mutation result, and state diagnostics unavailable on hosts without them
created: 2026-09-27
why: The model only sees type errors if it decides to call the diagnostics tool; feeding them after each edit is the verification signal harnesses credit for catching failures early, and the Workbench host already has the source.
user_story: As a developer watching the agent edit TypeScript in the playground, I want the edit result to already show the new type errors, but today it says `edited <path>` and the model must call `diagnostics` itself.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-weak-model-baseline-lane]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0426-no-coi-agent-host-and-explicit-resident-exit.md]
code: [packages/agent/src/tools.ts, packages/agent/src/workbench-host.ts, packages/agent/src/sandbox-host.ts]
---

## Context

finding — goal slice 10 (I10); after slice 4 (baseline before mechanisms).

- Ours: `tools.ts:330` `diagnostics` is a separate tool offered when
  `capabilities.diagnostics` exists (Workbench companion); edit results are
  `edited <path>` / `patched <paths>`; sandbox hosts have no diagnostics
  (ADR-0426, `sandbox-host.ts`).
- Evidence (§Research): post-tool verification hooks are credited for
  catching failures early; VERIFY is a named failure class.
- After this slice: on a Workbench host, after a successful `edit_file`,
  `write_file` or `apply_patch`, the tool result appends the host diagnostics
  summary for the changed files (count + first entries, inside the 16 KiB
  cap); on a host without diagnostics the result states
  `diagnostics: unavailable`, or `diagnostics: pending` when the host has not
  produced them within the bounded wait (I10); the standalone `diagnostics`
  tool stays.
- Carrier notes for PICKUP: `afterToolCall` (`session.ts:154`) already wraps
  results; the diagnostics read must not block the run on a slow language
  service — I10 admits `diagnostics: pending` after the bounded wait, never a
  silent omission; no new diagnostics source.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (verification feed, tier).
