# Stops — what only the user decides; stall, re-cut (`STOP`)

A stop is a decision only the user can make. Everything else the agent decides,
records, and continues (`decisions.md`). The test: **a stop names what the
user decides that the agent cannot.** "Continue?" is a status line — the user
is in the session and interrupts. Spend is never a stop: the user owns WHAT
gets built, never HOW MUCH is spent getting there.

Removed ids (2026-09-05; older ledgers still cite them): `STOP-2` rounds
budget, `STOP-5` contract escalation (now a `STOP-3` stall), `STOP-1c`
budget exhausted, `STOP-1d` slice cap. Surviving letters keep their places.

## STOP-1 Closed list — the only user stops

- **a. Observable-scope fork** — a fog line `owner: user`; a traced (`I#` /
  `scenario`) row that a re-cut would drop or weaken (`readiness.md` `RDY-5`)
  → manual `rifty-refine`.
- **b. Premise concern** — value does not follow / cheaper rival route not
  answered by a `rejected route:` line (`review.md` `REV-6`).
- **e. Destination conflict** — the run needs `goal.md` to change (amend =
  CLOSE + FIT).

Inside a goal a `STOP-1a` fork does not halt the run: the child leaves the
path with its question as a fog line `owner: user` (`STOP-4` 3) and the run
takes the next frontier child; the question is asked when it blocks — a
frontier empty because of it, or CLOSE — and the user, being in the session,
may answer earlier (`rifty-refine`). `STOP-1b` and `STOP-1e` question the
destination itself and halt the run: the goal PR stays draft with the
branch as it is — the user's answer (continue, or CLOSE + FIT) decides what
happens to it. A unit without a goal has no other frontier: it stops at
once.

Never a stop: the end of a stage, push, draft PR, split, re-cut, demotion of
untraced rows, rechart, choosing carriers, ordinary review fixes, a review
pass, a unit leaving the path (`STOP-4`), an invalid reviewer verdict twice
(a harness failure: the run ends with the `STOP-6` report and the session
that started it re-invokes once the harness is back — never the run itself).
An agent asking
"may I split?" or "may I keep going?" has misread this list.

## STOP-3 Stall

A FIX blocker surviving a fix + verify pass unchanged (same authority, same
summary) is a stall → `STOP-4`, never another fix — at either checkpoint.
Passes are not counted and a new real defect at a verify pass is not a stall:
that is the review doing its job (2026-09-04 `no-coi-sandbox-tier`: a Final
with 5/5 HOLDS inside frozen `I4`/`I6`/`I8`/`I10` stopped the run 4.5 h
because a round counter was spent; with reception (`review.md` `REV-12`) a
pass with no FIX is a PASS, so a counter could only ever count stalls; the
"2nd Contract+RED blocker = the contract is wrong" rule of 2026-09-02 fired
on round two of settling designs that converged in eight). A blocker on a
row the previous pass graded `pass` is reviewer error (`REV-4`) and goes to
reception, never to a fix.

## STOP-4 Re-cut against the destination, then leave the path

Once per checkpoint, by the runner:

1. Trim the unit to its traced obligations; demote untraced rows to notes or
   backlog; exactness the trace target does not state becomes a concern
   (`review.md` `REV-3`). Two intents → split by trace; the successor is
   seeded in `## Items` next to its predecessor, and one carrying only
   certified rows inherits the verdict (`readiness.md` `RDY-5`); rejected /
   noted findings never seed one (`REV-12`).
2. Record `re-cut: <date> — <what> — trace: none` (or `fork:` → `STOP-1a`).
3. One verify pass on the new tree. Pass → continue. The stall survives → the
   unit leaves the path, the same exit a mid-run `STOP-1a` fork takes: the
   unit is demoted to `draft` with its rows verbatim (`RDY-5`); RECHART
   removes its `## Items` row, reverts the unit's product and test commits on
   the goal branch (the branch carries landed slices only — `review.md`
   `REV-1`; the doc and its demotion stay; the work stays in git history) and
   writes the resisting obligation as a fog line owned like its trace:
   `owner: user` for an `I#` / `scenario` row or a fork, `owner: agent` for
   an ADR-, rule- or untraced row (`RDY-5`, `../artifacts/map.md`); the run
   takes the next frontier child. An `owner: user` line is asked where fog is
   always asked — a frontier empty because of it (a `blocked_by` chain behind
   the unit) or CLOSE (`STOP-1a`), never probed; an `owner: agent` line waits
   for facts (RECHART) or is dropped at CLOSE with its reason. Never a wait,
   never a second re-cut at that checkpoint, no new state: the map already
   knows how to hold a question. A unit without a goal has no next child: a fork stops
   (`STOP-1a`); any other surviving stall means the unit does not land — one
   `STOP-6` report, no question.

## STOP-6 Stop report

One screen: what blocked (blockers with authority; a destination conflict
quotes the exact `I#` / scenario clause), what was tried (passes, re-cut,
what withstood it), the single question asked, and the default if the user
stays silent. The ledger gets a `stop:` line (`../artifacts/ledger.md`). A
stop without a question is a status, not a stop — and a question the process
already answers ("continue?") is a status too. The same screen reports a unit
that left the path or a run out of frontier: no question, no wait.
