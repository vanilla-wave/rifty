# ledger.md — append-only journal

`docs/backlog/epics/<slug>/ledger.md`. Lines are never edited or removed; CLOSE
exports every line to a durable carrier or drops it explicitly. One line =
`- <date> — <gist>; <link>`: a decision, an observation, a reception verdict
(what was rejected and why, what was noted — `review.md` `REV-12`), a stop
(`stop: STOP-1a — <question>`), a unit leaving the path (`stops.md`
`STOP-4`), a CLOSE drop (`dropped: <reason>`). No other grammar: a fact with
no form yet is still one line. A diagnosis or observation with no carrier yet
gets a `reference/` file now — a contract is never edited to hold it
(`readiness.md` `RDY-4`).

One line is machine-read — the landed slice's PASS record and the next
slice's `BASE` (`review.md` `REV-8`), written by RECHART:

```md
- <date> — re-chart after <slice> (final-green PASS @ <sha>): <n> graduated / <m> invalidated / no changes
- <date> — re-chart after <slice> (ordinary PASS @ <sha>): …      review: ordinary units
```

A reception line closes its findings: not a carrier, never graduating into
a unit (`REV-12`). Verdict lineage is not journaled here —
the unit's `ready-verdict:` line and git log are.
