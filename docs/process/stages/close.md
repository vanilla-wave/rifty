# CLOSE — export knowledge, then delete the goal whole

Preconditions: last landed slice carries its `re-chart after` line; no `epic:`
backlinks remain; unit/goal residuals empty; every `## Invariants` statement
proven end-to-end — run the named proof and cite its artifact (a source grep,
a warning, one green slice closes nothing — `../rules/review.md` `REV-9`).

1. **Ledger + fog walk — exhaustive.** Every ledger line AND every `map.md`
   fog line ends in exactly one of: an existing durable carrier (item, ADR,
   `reference/`, compat, `traps.md`) verified to resolve; a carrier minted now
   (finding draft, `reference/` file, §Declined concepts row); an explicit
   `dropped: <reason>` line. A fog line with a trigger ("only if X") is
   checked against the goal's exported evidence — fired → carrier, never a
   drop. Hooks, candidate names, diagnoses, external promises (perf numbers,
   ADR claims, compat rows) are part of the walk; recorded before/after numbers
   export with a direction verdict (improved / regressed /
   noise-indistinguishable, + why).
2. **Rejections.** Concepts killed during this goal → rows in
   `docs/adr/README.md` §Declined concepts.
3. **Delete whole.** Remove `goal.md` + `map.md` + `ledger.md` in the closing
   PR; CHANGELOG line; `pnpm backlog:check` proves no dangling links.

Done when the directory is gone and every line has a carrier or an explicit
drop.
