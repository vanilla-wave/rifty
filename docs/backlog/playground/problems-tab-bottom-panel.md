---
area: playground
status: parked
title: PROBLEMS tab in playground bottom panel (Monaco markers)
created: 2026-06-08
why: VSCode-faithful proposal included a PROBLEMS tab but it was not one of the four asks; v1 ships Console-only
sources: [ADR-0075]
---
## Context
The VSCode-faithful proposal included a PROBLEMS tab fed by Monaco markers. Not one of the four asks, so v1 ships a single Console panel (the relocated terminal). The bottom panel is already a tabbable container.
## Options / Next
Provisional (deferred non-goal in ADR-0075 "Alternatives considered"): Console-only. Next: add a read-only PROBLEMS tab from `monaco.editor.getModelMarkers` as a follow-up — no container work needed.
## Reversibility
Reversible — additive tab in the already-tabbable bottom panel; no provisional code to revert. Parked non-goal.
