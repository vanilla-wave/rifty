# RECHART — fold new facts back into the map

Runs after every landed slice (Final+GREEN on the goal branch) or whenever
facts arrive that touch this goal. The map is a live hypothesis; only
`goal.md` is frozen. Driver session (`DEC-5`).

1. **Ledger.** One-liners for what the slice learned or decided — gist + link.
   A diagnosis with no carrier gets a `reference/` file now; never a contract
   edit (`../rules/readiness.md` `RDY-4`).
2. **Graduate.** Fog lines the facts made phrasable → mint draft children
   (`rifty-to-backlog` shape, `## Challenge`, `epic:` link); delete the fog
   line — fog lives only as its new item.
3. **Invalidate.** Unpicked items the facts contradict: drafts re-cut or
   delete freely; a ready item re-cuts per `RDY-5` (traced-row weakening →
   `STOP-1a`); mis-scoped work → one `## Out of scope` line. Classify every
   discovery: required → reverse-linked draft child; outside →
   `rifty-to-backlog`. A review finding is not a discovery: its `REV-12`
   disposition is final — `rejected:` / `note:` lines never graduate; a NOTE
   becomes scope only via `rifty-refine`.
4. **Reorder** seed order if dependencies changed.
5. **Record** `re-chart after <slice> (final-green PASS @ <sha>): <n>
   graduated / <m> invalidated / no changes` (`ordinary PASS @ <sha>` for a
   `review: ordinary` unit) — `<sha>` is the reviewed commit of the PASS;
   this line is the slice's PASS record and the next slice's
   `BASE` (`REV-8`). PICKUP and CLOSE refuse while the last landed slice lacks
   it.

Done when the map matches ALL known facts.
