# PICKUP — compile and gate the next slice

Input: a ready goal with a frontier. Output: one ready unit with band, rounds,
review membership; no implementation started. Fresh worker session.

0. **Re-chart debt.** Ledger tail shows a landed slice without its `re-chart
   after <slice>` line → run `rechart.md` first.
1. **Choose.** The user-named child, else the first frontier child
   (`../artifacts/map.md`).
2. **Compile** draft → ready per `../rules/readiness.md` `RDY-2`: evidence per
   row; internal forks resolved yourself; a user-observable fork or an `owner:
   user` fog line the slice depends on → stop (`STOP-1a`), request manual
   `rifty-refine`, never interview.
3. **Trace + size** (`RDY-3`, `RDY-4`): every Acceptance/Parity/Fault row
   traced; ≤ 15 traced rows, ≤ 200 lines, one-sentence `title`. Over → split
   now, before any review; successors reference each other.
4. **Membership + budget** (`RDY-8`, `RDY-9`): record `review: checkpoints
   rounds:<n>` or `review: ordinary` in the unit; append the ledger row
   `<date> — <slice> band <lo>–<hi> rounds <n>`, band sized from the
   expected-RED batch. Far above any prior estimate = too big: split.
5. **Contract+RED** — `checkpoints` units only — via `contract-red.md`
   (`checkpoint-run.md`). A split successor carrying only certified rows
   inherits (`RDY-9`). `ordinary` units skip both checkpoints.
6. **Hand off.** Implementation is `implement.md`; this stage ends here.

Done when verdict, membership, band and rounds are recorded and no
implementation has started.
