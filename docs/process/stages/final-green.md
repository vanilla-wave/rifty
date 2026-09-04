# Final+GREEN — certify the delivered slice

Subject: the slice diff from `BASE` (prior landed slice's reviewed tree, else
branch base — `../rules/review.md` `REV-1`), on one clean committed tree.
Requires the PR; the runner first runs `pnpm pr:check` on the committed SHA.
Runner: `checkpoint-run.md`.

- Evidence bar: `REV-5` Final+GREEN — `pass` judged adversarially, bounded by
  the clause as declared; strengthening beyond it is a concern (`REV-2`,
  `REV-3`).
- Pass → the slice has landed on the goal branch; `rechart.md` records
  `re-chart after <slice> (final-green PASS @ <sha>)` — the only PASS record
  and the next slice's `BASE` (`REV-8`).
- Blocker → status line `final-green: round <n>/<budget> — blocker @ <sha>`;
  batch fix; verify; rounds per `RDY-9`; stall or a spent budget →
  `../rules/stops.md` `STOP-3`/`STOP-4`, then the park rung (`STOP-2`) — the
  ladder always has a next rung, so the run never waits on spend.
- Unit residuals must be empty to land (`REV-9`); goal residuals continue the
  run.
