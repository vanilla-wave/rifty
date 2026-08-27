# CLOSE — export knowledge, then delete the goal whole

Preconditions: the last landed slice carries its `re-chart after <slice>`
ledger line, no `epic:` backlinks remain, unit/goal residuals empty, and
every `## Invariants` statement proven end-to-end — run the named proof and
cite its artifact; a source grep, a warning, or one green slice closes nothing.

1. **Ledger + fog walk — exhaustive.** Every ledger line AND every `map.md`
   `## Open questions` fog line ends in exactly one of:
   - already points at a durable carrier (item, ADR, `reference/`, compat,
     `docs/process/traps.md`) — verified to resolve;
   - gets a carrier now: mint a finding draft, a `reference/` file, or a
     §Declined concepts row;
   - gets an explicit `dropped: <reason>` line appended.
   A fog line with a stated trigger ("only if X") is checked against the
   goal's own exported evidence — trigger fired → carrier, never a drop.
   Hooks, candidate names, diagnoses, and external promises this goal touched
   (perf numbers, ADR claims, compat rows) are part of the walk — verify each
   is still true on main or export the correction. Recorded before/after
   numbers export with a direction verdict (improved / regressed /
   noise-indistinguishable, + why) — a bare table states nothing.
2. **Rejections.** Concepts killed during this goal → rows in
   `docs/adr/README.md` §Declined concepts, so the next audit doesn't re-open
   them.
3. **Delete whole.** Remove `goal.md` + `map.md` + `ledger.md` in the closing
   PR; add the CHANGELOG line. `pnpm backlog:check` proves no dangling links.

Done when the directory is gone and every ledger and fog line has a carrier or
an explicit drop — knowledge never dies with the goal.
