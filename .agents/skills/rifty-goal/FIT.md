# FIT — chart a goal

Input: a ratified outcome (user hand-off, refined draft, or legacy single-file
epic). Derive, never invent scope: everything below comes from the ask and its
recorded decisions.

1. **Bounded-destination test.** The outcome must be provably closable. A
   direction, theme, or standing invariant is not a goal: route it to
   `docs/ROADMAP.md`, an owner doc, or a ratchet — and stop. A legacy epic that
   fails the test is re-typed the same way and its file deleted.
2. **Destination.** Create `goal.md` (`status: draft`): frontmatter, `##
   Outcome`, `## User scenario` (real package/program, exact calls). Legacy
   epic: carry its ratified content verbatim; the old file is deleted in the
   same commit.
3. **Probe-or-fog.** Enumerate every external-semantics assumption the plan
   encodes (npm tree/bins/peers, Node behavior, browser APIs). Each gets either
   a discriminating probe — command + output + version, disposable spike
   subagents run in parallel, artifact kept — or a `## Open questions` line in
   `map.md`. Done when no assumption is left implicit: each has a probe
   artifact or a fog line.
4. **Invariants + tier.** Draft numbered `## Invariants` from
   Outcome/scenario/decisions only — an invariant needing unsettled scope is an
   observable fork → request manual `rifty-refine` for that statement. Check
   each false on current main; record the evidence in a comment above the list.
   Pick `tier` (§Tier) and justify it in one `## Decisions` line.
5. **Map.** Seed ONLY specifiable children — the minimal pattern first (the
   null/install-only case of a shared mechanism before machinery for the
   maximal case). A child whose contract depends on an open question stays
   unseeded; don't pre-slice the fog. Add `## Out of scope`.
6. **Ledger.** Create `ledger.md` with one header line.
7. **Signoff.** Put invariants AND tier to the user; on approval add
   `signoff: <date> — user (invariants + tier)` to `## Decisions` and flip
   `status: ready`. A missing signature blocks the RUN, never this write-up —
   leave the goal `draft` and report.

Done when `pnpm backlog:check` passes and every fit-time decision lives in
`goal.md`, `map.md`, or a ledger line — nothing only in conversation.
