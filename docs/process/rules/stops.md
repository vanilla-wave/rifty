# Stops — what only the user decides; budget, stall, re-cut (`STOP`)

A stop is a decision only the user can make. Everything else the agent decides,
records, and continues (`decisions.md`).

The test: **a stop names what the user decides that the agent cannot.** If the
only answers are "continue" or "stop what you are doing anyway", it is a status
line, not a stop — the user is in the session and interrupts; asking permission
to keep working is a permission model for an absent user. Spend is therefore
never a stop: what the user owns is WHAT gets built, never HOW MUCH is spent
getting there.

Overturns the 2026-08-31 scheme (count-delta convergence, "valves take no
budget by design") and its 2026-09-02 successor `STOP-1c`: both asked the user
to authorize work the agent owns — 2026-08-31, 3 interventions / 0 decisions
about the destination; 2026-09-04 `no-coi-sandbox-tier`, a Final whose
adjudication ruled 5/5 HOLDS — five real defects inside frozen `I4`/`I6`/`I8`/
`I10` — stopped the run for 4.5 h because the round counter was spent. The
review working perfectly is not a reason to ask permission.

## STOP-1 Closed list — the only user stops

- **a. Observable-scope fork** — a fog line `owner: user`; a traced (`I#` /
  `scenario`) row that a re-cut would drop or weaken (`readiness.md` `RDY-5`);
  any active-baseline change → manual `rifty-refine`.
- **b. Premise concern** — value does not follow / cheaper rival route not
  answered by a `rejected route:` line (`review.md` `REV-6`).
- **e. Destination conflict** — the run needs `goal.md` to change (amend =
  CLOSE + FIT).

Letters `c` (budget exhausted) and `d` (slice cap) are removed; the letters of
the surviving three do not move, so ledger history stays readable. A spent
budget changes the approach and reports (`STOP-2`); a slice cap the user set at
hand-off is a mandate, so reaching it ends the run with a report — neither asks.

Never a stop: the end of a stage, push, draft PR, split, re-cut, demotion of
untraced rows, band or rounds declaration, rechart, choosing carriers, ordinary
review fixes, a spent round budget, a parked unit. An agent asking "may I
split?" or "may I keep going?" has misread this list.

## STOP-2 Budget — a tripwire, never a gate

The Final+GREEN rounds are declared at pickup (`readiness.md` `RDY-9`);
Contract+RED has one round by construction (`STOP-5`). Spent rounds are read
from the checkpoint's status line in the unit (`review.md` `REV-8`). One round
= one batch fix + one verify pass. The count is observable or it does not
exist.

The budget bounds CHURN, not work: a round spends the count when its reception
(`review.md` `REV-12`) yields no `FIX` — only `REJECT`/`NOTE` — or when a
blocker survives unchanged (`STOP-3`). A round that closes real defects is the
review doing its job and costs nothing.

Tripping the wire never asks and never waits — it forces the next rung of the
ladder, each recorded in the ledger:

1. re-cut against the destination (`STOP-4`), once per lineage;
2. park the unit — `status: draft`, a ledger line naming what withstood the
   re-cut, the map row marked blocked — and take the next frontier child;
3. nothing left to advance → the run ends with the `STOP-6` report. That is a
   report, not a question.

A scope change at any rung is the user's (`STOP-1a`). A slice cap the user
declared at hand-off ends the run at rung 3 the same way.

## STOP-3 Stall

A blocker surviving a fix + verify round unchanged (same authority, same
summary) is a stall: remaining rounds are not spent — go to `STOP-4`. Genuinely
new `FIX` findings are the opposite of a stall and spend no round (`STOP-2`);
a verify pass rules on the settled list plus new defects, and a blocker on a
row the previous pass graded `pass` is reviewer error (`review.md` `REV-4`)
that goes to reception (`REV-12`), never to a round. Overturns "new findings
each round are not progress either" (2026-08-31): written against a reviewer
inventing exactness demands, it also punished a reviewer finding real bugs —
`REV-12` now tells the two apart.

## STOP-4 Re-cut against the destination (agent-owned, once per lineage)

1. Trim the unit to its traced obligations; demote untraced rows to notes or
   backlog; rows the trace target does not require in the demanded exactness
   become concerns (`review.md` `REV-3`).
2. Over `RDY-4` limits → split by trace; the successor's `re-cut:` line names
   the predecessor (`RDY-9`). A successor carrying only proof rows — no
   product delta expected — is `review: ordinary — proof-only`
   (`readiness.md` `RDY-8`), never a checkpoint lineage. A successor carries
   traced rows only; `rejected:` / `note:` findings never seed one
   (`review.md` `REV-12`).
3. Record `re-cut: <date> — <what> — trace: none` (or `fork:` → `STOP-1a`).
4. One verify pass on the new tree. Pass → continue. Blockers survive → next
   rung (`STOP-2`): park the unit and take the next frontier child; a
   design-level cause takes an ADR first. Never a wait.

## STOP-5 Contract escalation

2nd consecutive Contract+RED blocker on one unit → the contract is wrong, not
the tests: `STOP-4` in place, never another review round. A 2nd escalation in
one lineage → the contract is not reviewable as cut: park it (`STOP-2` rung 2)
with the ledger line naming what resisted both cuts. Only a change to
observable scope goes to the user (`STOP-1a`).

## STOP-6 Stop report

One screen: what blocked (blockers with authority; a destination conflict
quotes the exact `I#` / scenario clause), what was tried (rounds spent, re-cut
performed, what withstood it), the single question asked, and the default if
the user stays silent. The ledger gets the `stop:` line
(`../artifacts/ledger.md`). A stop without a question is a status, not a stop —
and a question the process already answers ("continue?") is a status too.

The same one screen reports a parked unit or a finished mandate (`STOP-2`
rungs 2-3): what resisted, what was tried, what the run did next. No question,
no wait — the user reads it and interrupts if they disagree.
