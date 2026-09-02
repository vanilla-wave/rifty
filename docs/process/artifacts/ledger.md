# ledger.md — append-only journal

`docs/backlog/epics/<slug>/ledger.md`. Lines are never edited or removed; CLOSE
exports every line to a durable carrier or drops it explicitly. One line =
gist + link to the full carrier (item, ADR, `reference/`, PR). A diagnosis or
observation with no carrier yet gets a `reference/` file now — a contract is
never edited to hold it (`readiness.md` `RDY-4`).

Line forms (`<date>` = `YYYY-MM-DD`):

```md
- <date> — <slice> band <lo>–<hi> rounds <n>            declared at pickup (RDY-9)
- <date> — decided <one line>; full answer: <link>
- <date> — <slice> ready-verdict: Contract+RED @ <sha>   (or: inherited from <predecessor> @ <sha>)
- <date> — <slice> checkpoint lineage: contract-red blocker @ <sha>, PASS @ <sha>; final-green blocker @ <sha>, PASS @ <sha>
- <date> — <slice> re-cut: <what> — trace: none | fork: <what> — trace: I#
- <date> — <slice> stop: STOP-1<letter> — <question asked>
- <date> — re-chart after <slice>: <n> graduated / <m> invalidated / no changes
- <date> — dropped: <reason>                              (CLOSE walk only)
```

The band row is review-checked (`review.md` `REV-10` axis 5); the rounds
budget is read by `stops.md` `STOP-2`.
