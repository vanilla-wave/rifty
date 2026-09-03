---
name: rifty-goal
description: Drive one rifty goal (epic) through its lifecycle — fit an outcome or legacy epic into a goal directory, pick up the next slice, re-chart the map after a landed slice, or close the finished goal. Invoke on a whole-epic hand-off, "fit/write up epic X", after a slice lands inside a goal, or when a goal's map is empty.
---

Owns transitions of ONE goal directory `docs/backlog/epics/<slug>/`. Canon:
`docs/process/README.md` (layers, roles, stages, stops). Plan, don't build:
every mode ends where implementation begins. Review, the user interview
(`rifty-refine`), unplanned defects (`rifty-fix`), and intake
(`rifty-to-backlog`) are other actors — hand off, never inline their work.

Detect the mode from state; run exactly one mode per invocation, in a fresh
session per mode (`DEC-5`):

| State | Mode → procedure |
|---|---|
| No goal dir — a hand-off naming an outcome, or a legacy single-file epic | FIT → `docs/process/stages/fit.md` |
| Ready goal with an open frontier | PICKUP → `docs/process/stages/pickup.md` |
| A slice of this goal just landed (Final+GREEN PASS on the goal branch), or new facts arrived | RECHART → `docs/process/stages/rechart.md` |
| Map `## Items` empty and invariants provable | CLOSE → `docs/process/stages/close.md` |

Standing rules: `goal.md` is frozen (amend = CLOSE + FIT); `ledger.md` only
grows; `map.md` and unit contracts are the agent's path (`RDY-5`). The only
user stops are `docs/process/rules/stops.md` `STOP-1`.
