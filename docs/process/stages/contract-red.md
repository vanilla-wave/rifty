# Contract+RED — certify the promise before code

Subject: the ready contract + its RED tests, on a clean tree, boundary
`BASE` per `../rules/review.md` `REV-1` (the prior landed slice's PASS, else
the branch base — `origin/main` for a unit without a goal). Never an
implementation in the diff. Runner: `checkpoint-run.md`.

- Evidence bar: `REV-5` Contract+RED — four blocker classes, each with an
  executed artifact; everything else is a concern.
- Coverage rows: traced obligations only (`REV-4`).
- Pass → `ready-verdict: <date> — Contract+RED @ <sha>` as the first
  `## Decisions` line — the only record (`../artifacts/ledger.md`).
- Blocker → reception, one batch fix, one verify pass (`checkpoint-run.md`);
  a FIX blocker surviving unchanged is a stall (`../rules/stops.md` `STOP-3`)
  → re-cut (`STOP-4`), never another fix.
