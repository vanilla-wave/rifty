# RECHART — fold new facts back into the map

Runs after every landed slice — Final+GREEN on the goal branch, or merge —
(or whenever facts arrive that touch this goal).
The map is a live hypothesis; only `goal.md` is frozen.

1. **Ledger.** Append one-liners for what the slice learned or decided — gist +
   link to the full carrier (item, ADR, `reference/`, PR). A diagnosis or
   observation with no carrier yet gets a `reference/` file now; ready
   contracts are never edited in place to hold it.
2. **Graduate.** Fog lines the new facts made phrasable → mint draft children
   (`rifty-to-backlog` shape incl. `## Challenge` — README §Challenge,
   `epic:` link) and delete those fog lines — fog lives only as its new item.
3. **Invalidate.** Unpicked items the new facts contradict: drafts re-cut or
   delete freely; a `ready` item weakens only through demotion with its fork
   recorded (§Backlog readiness 5); mis-scoped work → one `## Out of scope`
   line. Classify every discovery: required → reverse-linked draft child;
   outside the goal → `rifty-to-backlog`.
4. **Reorder** seed order if dependencies changed.
5. **Record.** Append the ledger line
   `re-chart after <slice>: <n> graduated / <m> invalidated / no changes` —
   PICKUP and CLOSE refuse while the last landed slice lacks it.

Done when the map matches ALL known facts: no item a fact contradicts, no
phrasable question still sitting in fog, no discovery left unclassified.
