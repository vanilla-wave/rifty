# Contract+RED — certify the promise before code

Subject: the ready contract + its RED tests, on a clean tree, boundary
`BASE` per `../rules/review.md` `REV-1`. Never an implementation in the diff.
Runner: `checkpoint-run.md`.

- Evidence bar: `REV-5` Contract+RED — four blocker classes, each with an
  executed artifact; everything else is a concern.
- Coverage rows: traced obligations only (`REV-4`).
- Pass → `ready-verdict: <date> — Contract+RED @ <sha>` as the first
  `## Decisions` line + ledger line; open the goal's draft PR if absent
  (`../rules/pr.md` `PR-3`).
- Blocker → status line `contract-red: round <n> — blocker @ <sha>`; one batch
  fix; one verify pass (budget `RDY-9`). A 2nd consecutive blocker →
  `../rules/stops.md` `STOP-5`: the contract is wrong — re-cut (`STOP-4`),
  never another round.

Outside a goal run (`BASE=origin/main`) the same stage certifies a standalone
ready item at its pickup (`RDY-1`).
