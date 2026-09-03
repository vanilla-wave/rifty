# Stops — budget, stall, re-cut, escalation (`STOP`)

A stop is a decision only the user can make. Everything else the agent decides,
records, and continues (`decisions.md`). Overturns the 2026-08-31 scheme
(count-delta convergence, "valves take no budget by design"): a 1→1 count
fired twice and a 1→15 count after a boundary change fired once in one day on
`no-coi-sandbox-tier`, each stop asking the user to authorize a split the agent
owns — 3 human interventions, 0 decisions about the destination.

## STOP-1 Closed list — the only user stops

- **a. Observable-scope fork** — a fog line `owner: user`; a traced (`I#` /
  `scenario`) row that a re-cut would drop or weaken (`readiness.md` `RDY-5`);
  any active-baseline change → manual `rifty-refine`.
- **b. Premise concern** — value does not follow / cheaper rival route not
  answered by a `rejected route:` line (`review.md` `REV-6`).
- **c. Budget exhausted after the re-cut** — `STOP-4` ran and blockers
  survive; or a 2nd contract escalation in one lineage (`STOP-5`).
- **d. Slice cap** of the run.
- **e. Destination conflict** — the run needs `goal.md` to change (amend =
  CLOSE + FIT).

Never a stop: the end of a stage, push, draft PR, split, re-cut, demotion of
untraced rows, band or
rounds declaration, rechart, choosing carriers, ordinary review fixes. An agent
asking "may I split?" has misread this list.

## STOP-2 Budget (appetite)

The Final+GREEN rounds are declared at pickup (`readiness.md` `RDY-9`);
Contract+RED has one round by construction (`STOP-5`). Spent rounds are read
from the checkpoint's status line in the unit (`review.md` `REV-8`). One round
= one batch fix + one verify pass. The count is observable or it does not
exist. Raising a declared budget is the user's; the agent's release valve is
`STOP-4`.

## STOP-3 Stall

A blocker surviving a fix + verify round unchanged (same authority, same
summary) is a stall: remaining rounds are not spent — go to `STOP-4`. New
findings each round are not progress either: a verify pass rules on the
settled list plus genuinely new defects; a blocker on a row the previous pass
graded `pass` is reviewer error (`review.md` `REV-4`) and goes to
adjudication, never to a round.

## STOP-4 Re-cut against the destination (agent-owned, once per lineage)

1. Trim the unit to its traced obligations; demote untraced rows to notes or
   backlog; rows the trace target does not require in the demanded exactness
   become concerns (`review.md` `REV-3`).
2. Over `RDY-4` limits → split by trace; the successor's `re-cut:` line names
   the predecessor (`RDY-9`).
3. Record `re-cut: <date> — <what> — trace: none` (or `fork:` → `STOP-1a`).
4. One verify pass on the new tree. Pass → continue. Blockers survive → stop
   (`STOP-1c`) with the `STOP-6` report.

## STOP-5 Contract escalation

2nd consecutive Contract+RED blocker on one unit → the contract is wrong, not
the tests: `STOP-4` in place, never another review round. A 2nd escalation in
one lineage → stop (`STOP-1c`): the contract is not reviewable, only the user
re-scopes it.

## STOP-6 Stop report

One screen: what blocked (blockers with authority; a destination conflict
quotes the exact `I#` / scenario clause), what was tried (rounds spent, re-cut
performed, what withstood it), the single question asked, and the default if
the user stays silent. The ledger gets the `stop:` line
(`../artifacts/ledger.md`). A stop without a question is a status, not a stop.
