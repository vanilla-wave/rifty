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

- **a. Observable-scope fork** — a live user choice established by `RDY-6`,
  including an omitted choice; a fog line `owner: user`; a traced (`I#` /
  `scenario`) row that a re-cut would drop or weaken (`readiness.md` `RDY-5`)
  → manual `rifty-refine`.
- **b. Premise concern** — value does not follow / cheaper rival route not
  answered by a `rejected route:` line (`review.md` `REV-6`).
- **e. Destination conflict** — the accepted result must change (`RDY-6`: explicit user amendment).

Inside a goal a `STOP-1a` fork does not halt the run: the child leaves the
path with its question as a fog line `owner: user` (`STOP-4`) and the run
takes the next frontier child; the question is asked when it blocks — a
frontier empty because of it, or CLOSE — and the user, being in the session,
may answer earlier (`rifty-refine`). `STOP-1b` and `STOP-1e` question the
destination itself and halt the run: the goal PR stays draft with the
branch as it is — the user's answer (continue, amend, or cancel) decides what happens to it. A unit without a goal has no other frontier: it stops at
once.

Never a stop: the end of a stage, push, draft PR, split, re-cut, demotion of
untraced rows, rechart, choosing carriers, review fixes, a review
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
row the previous pass graded `pass` is reviewer error (`REV-4`) and goes
through reception like any finding — never straight to a fix, never ignored:
ruled HOLDS, it is FIX.

## STOP-4 Change the approach; keep the obligation

On a stall, check the authority and diagnosis, trim unsupported demands and
choose a materially different design or discriminating probe. Record what new
fact can settle the problem. Do not repeat the same fix/review without new
information; no numeric budget chooses when a real obligation disappears.

If the next experiment needs facts not available yet, keep the obligation on
the map with its owner, dependency and trigger; continue independent work.
The source of the requirement never makes a technical problem user-owned.
Revert unsafe partial changes before other units rely on them; keep evidence
and history. RECHART owns dependency updates (`stages/rechart.md`).

No executable approach left → report the technical limit and what would unblock
it (`STOP-6`). A standalone unit does not land; a goal continues wherever it
can. The user is asked only for an actual result/tier/tradeoff choice (`STOP-1`).
Required work cannot be dropped or silently parked as an optional note.

## STOP-6 Stop report

One screen: what blocked (blockers with authority; a destination conflict
quotes the exact `I#` / scenario clause), what was tried (passes, re-cut,
what withstood it), the single question asked, and the default if the user
stays silent. The ledger gets a `stop:` line (`../artifacts/ledger.md`). A
stop without a question is a status, not a stop — and a question the process
already answers ("continue?") is a status too. The same screen reports a unit
that left the path or a run out of frontier: no question, no wait.
