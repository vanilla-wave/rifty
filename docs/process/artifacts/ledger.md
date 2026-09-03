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
- <date> — <slice> re-cut: <what> — trace: none | fork: <what> — trace: I#
- <date> — <slice> stop: STOP-1<letter> — <question asked>
- <date> — re-chart after <slice> (final-green PASS @ <sha>): <n> graduated / <m> invalidated / no changes
- <date> — re-chart after <slice> (ordinary PASS @ <sha>): …      review: ordinary units (RDY-8)
- <date> — dropped: <reason>                              (CLOSE walk only)
```

The band row is review-checked (`review.md` `REV-10` axis 5); the rounds
budget is read by `stops.md` `STOP-2`. The rechart line is the only record of
a landed slice's PASS and the `BASE` of the next slice (`REV-8`); verdict
lineage is not journaled here — the unit's status line and its git log are.
