---
name: rifty-goal
description: Drive one rifty goal (epic) through its lifecycle — fit an outcome or legacy epic into a goal directory, pick up the next slice, re-chart the map after a merge, or close the finished goal. Invoke on a whole-epic hand-off, "fit/write up epic X", after a slice PR merges inside a goal, or when a goal's map is empty.
---

Owns transitions of ONE goal directory `docs/backlog/epics/<slug>/` — shape:
`docs/backlog/README.md` §Epic fit, template `epics/TEMPLATE.md`. Plan, don't
build: every mode ends where implementation begins and resumes after merge.
Review (`rifty-review`), the user interview (`rifty-refine`), unplanned defects
(`rifty-fix`), and intake (`rifty-to-backlog`) are other actors — hand off,
never inline their work.

Detect the mode from state; run exactly one mode per invocation:

| State | Mode |
|---|---|
| No goal dir — a hand-off naming an outcome, or a legacy single-file epic | [FIT](FIT.md) |
| Ready goal with an open frontier (unblocked, unpicked children) | [PICKUP](PICKUP.md) |
| A slice of this goal just landed (Final+GREEN on the goal branch, or merge), or new facts arrived | [RECHART](RECHART.md) |
| Map `## Items` empty and invariants provable (fog lines disposition inside CLOSE) | [CLOSE](CLOSE.md) |

Standing rules: a ready `goal.md` never changes (amend = CLOSE + fresh FIT);
`ledger.md` only grows; `map.md` is yours to edit — but it is an index, not a
store: one line + link, content lives on items and the ledger.
