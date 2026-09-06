# Final+GREEN — certify the delivered slice

Subject: the slice diff from `BASE` (prior landed slice's PASS, else branch
base — `../rules/review.md` `REV-1`), on one clean committed tree. Requires
the PR; the runner first runs `pnpm pr:check` on the committed SHA. Runner:
`checkpoint-run.md`.

- Evidence bar: `REV-5` Final+GREEN — `pass` judged adversarially, bounded by
  the clause as declared; strengthening beyond it is a concern (`REV-2`,
  `REV-3`).
- Pass → the slice has landed. Inside a goal `rechart.md` records `re-chart
  after <slice> (final-green PASS @ <sha>)` — the PASS record and the next
  slice's `BASE`; either way the runner commits the verdict as
  `reference/<slug>-final-green.json` with `reviewed_sha` (`REV-8`). A unit
  without a goal then deletes its doc in a last bookkeeping commit (delete on
  done — the artifact stays) and merges after `pnpm check:pass-binding` is
  green (`DEC-3`); a unit with no doc merges on its `…-ordinary.json`.
- Blocker → reception, batch fix, verify (`checkpoint-run.md`); a stall →
  `../rules/stops.md` `STOP-3`/`STOP-4`. No pass count.
- Unit residuals must be empty to land (`REV-9`); goal residuals continue the
  run — RECHART reads them from the verdict. Exits: `checkpoint-run.md` 3.
