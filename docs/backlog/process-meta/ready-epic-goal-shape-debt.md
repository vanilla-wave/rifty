---
area: process-meta
status: draft
title: Ready epics carry no Invariants/tier/Budget — every hand-off starts with an unplanned refit
created: 2026-07-30
why: README §Shape requires numbered `## Invariants` on a ready epic, but the gate only fires once `goal_baseline` exists, so 10 of 11 ready/in-progress epics are shaped for reading, not for pickup — and the missing parts (Invariants, tier) cannot be authored by an agent
user_story: As the repo owner handing off a ready epic, I want the hand-off to start the run, but today it starts a refit — invariants sign-off, tier call, and a Budget table before any slice can be picked
sources: [docs/backlog/README.md §Shape, tools/backlog/check.mjs:231, M11 parallel-track sweep 2026-07-30]
code: [docs/backlog/README.md, tools/backlog/check.mjs]
---

## Context

Measured on `5296991f5`: of 11 `ready`/`in-progress` epics only
`honest-shadow-substitutions` (the one already in a run) carries `## Invariants`,
`tier:`, and `## Budget`. The other 10 — `fault-honest-sw-preview`,
`wasi-in-browser-showcase`, `open-auditable-launch`, `embeddable-dev-loop`,
`cold-npm-install-speedup`, `fault-honest-opfs-persistence`,
`trusted-state-authority`, `webcontainers-alternative-search-slot`,
`preset-deglue`, `fast-install-resolver` — carry none of the three.

Not a validation hole by accident: `tools/backlog/check.mjs:231` demands
`## Invariants` only when `goal_baseline` is present, so `backlog:check` reports
17 epics / 0 invalid. README §Shape states the requirement for every ready epic
and defers it ("legacy epics add them at next refine"); nothing measures the
deferral, so the cost lands at hand-off time.

The refit is not mechanical: `epics/TEMPLATE.md` says invariants are authored
WITH the user (refine interview or direct sign-off) and the run only proves
them, and `process-meta/autonomous-epic-runs.md` adds a falsified-on-main proof
per invariant. `tier` is a fidelity call. So a hand-off that reads "run this
ready epic" silently means "interview me first" — the exact surprise this item
records.

Dedup (no match): `process-meta/draft-gate-enforcement` gates implementing FROM
a draft and the `ready-verdict:` laundering channel — a different gate family;
`process-meta/milestone-review-ritual` sweeps stale items at milestone close;
`process-meta/autonomous-epic-runs` §Residual lists machine gates encoding
PR-as-unit-of-process. None covers epic goal-shape debt.

## Options or Next

Pick at refine; each is a different cost/timing trade:

- lazy (status quo, made honest): keep the debt, but say it at the point of
  hand-off — e.g. `backlog:check` warns (not fails) on a ready epic without
  Invariants/tier so the refit is priced before the run is promised;
- eager batch: one refine pass per epic, ordered by which epics are actually
  near pickup (M11 first), each producing invariants + tier + Budget;
- gate: require the three on `draft→ready` for NEW epics only, leaving the 10
  legacy ones on the lazy path — stops the debt growing without a big-bang.

Not an option: an agent authoring the invariants to clear the check — that
inverts the rule the invariants exist to enforce.
