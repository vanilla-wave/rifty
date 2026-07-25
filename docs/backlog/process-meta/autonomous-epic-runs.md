---
area: process-meta
status: draft
title: Bounded autonomous epic runs — orchestration, tripwire automation, escape-rate trial
created: 2026-07-22
why: epic hand-off now has substrate-first ordering, Budget tripwires, and contract-drift enforcement, but the run itself is still conversational — checkpoints, stop semantics, and most tripwire counters are process, not machinery
sources: [workbench-retro-2026-07, PR-161, PR-162]
code: [.agents/skills/rifty-review-loop, tools/checks/contract-drift.mjs]
---

## Context

Deferred half of the "hand a whole epic to an agent" package. Already decided direction (recorded here, not re-litigated at refine):

- Orchestration enforces the EXISTING two-checkpoint protocol mechanically — blocker → STOP and surface to the human, never auto-redesign, never a third round. Runs add no new loops; anything that would loop stops instead (cycle fear is the design constraint, not an afterthought).
- Implementer and reviewer are separate contexts (`rifty-review-loop` codex exec is the seed); redesign decisions never happen inside a run.
- Tripwire automation beyond `check:contract-drift`: scope-outside-ready-items (diff→item mapping), new-mechanism detector (pending-map/opId shape inventory), per-item diff-mass vs Budget estimate, review-round counter, epic-envelope drift (frozen sections — Outcome/Scenario/Invariants/tier/Out-of-scope/Budget — diffed vs base; change without a named re-refine event fails), ready-flip without recorded judge verdict (`ready-verdict:` line, PR #176). Semi-manual (review axis) until each detector is honest — no fake precision.
- Adoption is measured, not believed: run the next mid-size epic through the pipeline and count escaped horizontal defects in the post-merge audit against the workbench baseline (five correlation engines, unowned glue mass, renarrated contracts). Each escape → a new check (retro→check compilation), then the delegation boundary moves.

Sequencing: tripwires before autonomy; no orchestration work until Budget counters exist for the run to trip on.
