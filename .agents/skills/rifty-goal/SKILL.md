---
name: rifty-goal
description: Drive one rifty goal (epic) through its lifecycle — fit an outcome or legacy epic into a goal directory, pick up the next slice, re-chart the map after a landed slice, or close the finished goal. Invoke on a whole-epic hand-off, "fit/write up epic X", after a slice lands inside a goal, or when a goal's map is empty.
---

Owns transitions of ONE goal directory `docs/backlog/epics/<slug>/`. Canon:
`docs/process/README.md` (layers, roles, stages, stops). Review, the user
interview (`rifty-refine`), unplanned defects (`rifty-fix`), and intake
(`rifty-to-backlog`) are entry helpers; the driver continues authorized work in this session.

Detect the mode from state. A whole-goal hand-off runs the README §Route loop
— PICKUP → Contract+RED → IMPLEMENT → Final+GREEN → RECHART until the map is
empty, then CLOSE — in this session (`DEC-5`), parking a `STOP-1` question on the map and continuing; the end of a stage is never the end of a turn; a re-entry reads the PR
body and the ledger tail. A single-mode ask ("fit X",
"re-chart", "close") runs that mode only:

| State | Mode → procedure |
|---|---|
| No goal dir — a hand-off naming an outcome, or a legacy single-file epic — or a `draft` goal dir (e.g. left on an unanswered user question or a just-file) | FIT → `docs/process/README.md` §FIT |
| Ready goal with an open frontier | PICKUP → `docs/process/README.md` §PICKUP |
| A slice of this goal just landed (Final+GREEN PASS on the goal branch), a unit left the path (`STOP-4`), or new facts arrived | RECHART → `docs/process/README.md` §RECHART |
| Map `## Items` empty and invariants provable | CLOSE → `docs/process/README.md` §CLOSE |

A refined epic normally arrives `ready`: FIT ran in the refine session
(`rifty-refine` §4). A `draft` goal dir here: its recorded `owner: user`
question is asked first, in this session (the `rifty-refine` interview); then
FIT from step 1. Packaging per `PR-3`.

Standing rules: `goal.md` is user-owned (explicit amendments per `RDY-6`); `ledger.md` only
grows; `map.md` and unit contracts are the agent's path (`RDY-5`). The only
user stop is `docs/process/README.md` `STOP-1`.
