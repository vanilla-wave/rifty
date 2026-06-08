---
area: process-meta
status: active
title: Run compat:generate once per milestone DoD cycle (fs/streams/http matrices)
created: 2026-06-08
why: per A-033, compat:generate is manually triggered by the milestone closer (not per-PR); fs/streams/http rows still flagged unpopulated and the obligation recurs every milestone
sources: [A-033, CLAUDE.md §"Definition of done", docs/public/compat/buffer.md generate-tooling note]
---
## Context
A-033 (2026-05-26 decision, documented in CLAUDE.md DoD): `pnpm compat:generate` is NOT run per-PR (keeps CI fast, avoids noisy churn) — the milestone closer runs it once and commits the diff. fs/streams/http compat-matrix sections were flagged empty/unpopulated; regeneration for the M10→M11 transition stays on the closer's plate. Standing per-milestone checklist obligation, not a one-shot fix. Related tooling gap: `docs/public/compat/buffer.md` is still hand-maintained "until pnpm compat:generate learns to source @riftydev/io tests" (own toolchain-build item).

## Options / Next
At each milestone DoD: run `pnpm compat:generate`, commit the diff to `docs/public/compat/*.md`. Next concrete step: at the current M10→M11 close, run it and verify fs/streams/http rows populate from the conformance suite. Keep as a recurring DoD line item — owned by whoever closes a milestone. Consider asserting in CI that the committed matrix is not staler than N milestones (warn, not block, per A-033's "keep CI fast" intent).

## Reversibility
REVERSIBLE — a process/checklist obligation; regenerating a generated doc. No API or dep change.
