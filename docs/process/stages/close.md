# CLOSE — export knowledge, then delete the goal whole

Preconditions: last landed slice carries its `re-chart after` line; no `epic:`
backlinks remain; unit/goal residuals empty; every `## Invariants` statement
proven end-to-end — run the named proof and cite its artifact (a source grep,
a warning, one green slice closes nothing — `../rules/review.md` `REV-9`) —
or dropped by the user on the record: an invariant the run cannot reach is a
destination conflict (`../rules/stops.md` `STOP-1e`), and the user's "drop
I6" lands as a ledger `dropped: I6 — <user words>` line; the goal closes
short, never amended in place.

0. **Invariant proof — fresh critic.** A fresh read-only critic (as
   `docs/backlog/README.md` §Challenge) runs each named proof and writes one
   ledger line per `I#` with its artifact, or names it unproven; the driver
   never grades its own goal. Unproven → `STOP-1e`.
1. **Ledger + fog walk — exhaustive.** Every ledger line AND every `map.md`
   fog line ends in exactly one of: an existing durable carrier (item, ADR,
   `reference/`, compat, `traps.md`) verified to resolve; a carrier minted now
   (finding draft, `reference/` file, §Declined concepts row); an explicit
   `dropped: <reason>` line. An `owner: user` fog line — including one left by
   a unit that left the path (`../rules/stops.md` `STOP-4`) — is asked here at
   the latest (`STOP-1a`); its answer re-seeds or deletes the unit. An
   `owner: agent` line whose resisting row traced to `I#` / `scenario` is
   never dropped by the driver: a substitute carrier the critic (step 0)
   proves, or the user's words (`STOP-1a`). A fog line
   with a trigger ("only if X") is checked against the goal's exported
   evidence — fired → carrier, never a drop. Hooks, candidate names,
   diagnoses, external promises (perf numbers, ADR claims, compat rows) are
   part of the walk; recorded before/after numbers export with a direction
   verdict (improved / regressed / noise-indistinguishable, + why).
2. **Rejections.** Concepts killed during this goal → rows in
   `docs/adr/README.md` §Declined concepts.
3. **Delete whole.** Remove `goal.md` + `map.md` + `ledger.md` in the closing
   PR; CHANGELOG line; `pnpm backlog:check` proves no dangling links.

Done when the directory is gone and every line has a carrier or an explicit
drop.
