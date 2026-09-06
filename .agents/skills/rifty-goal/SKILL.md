---
name: rifty-goal
description: Drive one rifty goal (epic) through its lifecycle — fit an outcome or legacy epic into a goal directory, pick up the next slice, re-chart the map after a landed slice, or close the finished goal. Invoke on a whole-epic hand-off, "fit/write up epic X", after a slice lands inside a goal, or when a goal's map is empty.
---

Owns transitions of ONE goal directory `docs/backlog/epics/<slug>/`. Canon:
`docs/process/README.md` (layers, roles, stages, stops). Review, the user
interview (`rifty-refine`), unplanned defects (`rifty-fix`), and intake
(`rifty-to-backlog`) are other actors — hand off, never inline their work.

Detect the mode from state. A whole-goal hand-off runs the README §Stages loop
— PICKUP → Contract+RED → IMPLEMENT → Final+GREEN → RECHART until the map is
empty, then CLOSE — in this session (`DEC-5`), stopping only on a `STOP-1`
item; the end of a stage is never the end of a turn. Claude sessions may hand
the loop to `.claude/workflows/goal-run.js`. A single-mode ask ("fit X",
"re-chart", "close") runs that mode only:

| State | Mode → procedure |
|---|---|
| No goal dir — a hand-off naming an outcome, or a legacy single-file epic | FIT → `docs/process/stages/fit.md` |
| Ready goal with an open frontier | PICKUP → `docs/process/stages/pickup.md` |
| A slice of this goal just landed (Final+GREEN or ordinary PASS on the goal branch), a unit left the path (`STOP-4`), or new facts arrived | RECHART → `docs/process/stages/rechart.md` |
| Map `## Items` empty and invariants provable | CLOSE → `docs/process/stages/close.md` |

Standing rules: `goal.md` is frozen (amend = CLOSE + FIT); `ledger.md` only
grows; `map.md` and unit contracts are the agent's path (`RDY-5`). The only
user stops are `docs/process/rules/stops.md` `STOP-1`.
