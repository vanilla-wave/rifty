# FIT — chart a goal

Input: a ratified outcome (a refine session's settled epic, a draft left on
an unanswered user question or a just-file, a user hand-off, a legacy
single-file epic). Output: a ready goal directory (`../artifacts/goal.md`,
`map.md`, `ledger.md`). Derive, never invent scope. Interactive: the user is
present — for a refined epic that is the refine session itself, on its branch
(`rifty-refine` §4); a hand-off or legacy epic starts FIT in the hand-off
session. A stage is never a PR boundary; packaging per `../rules/pr.md`
`PR-3`.

1. **Bounded-destination test.** Provably closable, or it is not a goal: a
   direction, theme, or standing invariant routes to `docs/ROADMAP.md`, an
   owner doc, or a ratchet — stop. A legacy epic failing the test is re-typed
   the same way and its file deleted.
2. **Destination.** Create `goal.md` (`status: draft`): frontmatter,
   `## Outcome`, `## User scenario`. A dir minted at refine formalize is
   verified, not re-created. Legacy epic: carry ratified content verbatim;
   delete the old file in the same commit.
3. **Owner first, then probe-or-fog.** Apply `RDY-6` §Establishing scope to
   material assumptions, including mappings such as "path X is the issue
   scenario"; reuse refine evidence for unchanged scope. Type each
   by OWNER before choosing an exit — a probe settles facts, never value:
   - user-owned (observable scope: what the value requires, what must NOT
     change, whose scenario counts) → ask now; no answer → the goal stays
     `draft` (step 9 does not flip);
   - agent-owned fact → discriminating probe (command + output + version;
     disposable spike subagents in parallel; artifact kept) or a fog line when
     it only shapes the route.
   A mixed question is split; the value half stays the user's. Each material
   assumption has an answer, artifact or agent-owned fog line under `RDY-6`.
4. **Invariants + tier.** Number `## Invariants` from Outcome/scenario/decisions
   only; an invariant needing unsettled scope → ask now (step 3); no answer
   → `draft`. Check each false on current main; record evidence above the
   list. Pick `tier` with one `## Decisions` line. A rejected rival route lands
   as `rejected route: <route> — violates <I#|Outcome clause>`; no invariant
   excludes it = add the missing invariant (step 3 asked).
5. **Map.** Seed only specifiable children, minimal pattern first; children
   stay `draft` (compiling here is scope error — PICKUP owns it, `RDY-1`). Add
   `## Out of scope`.
6. **Ledger.** One header line.
7. **Challenge.** Apply `docs/backlog/README.md` §Challenge to the outcome and
   route, reusing an early checked premise for unchanged promises. A missing
   check or new evidence/changed promises gets a fresh critic with the original
   user input/answers, `goal.md`, `map.md` and evidence per §Challenge.
   Record its verdict in `## Challenge`.
8. **Final written-result check.** After all drafts exist, apply `RDY-6`
   §Final check of the written result to goal/map/seeded drafts together in
   a fresh reviewer context. Reuse only an unchanged result already checked
   at this final boundary, never an early premise verdict. Resolve findings
   and recheck material edits before completing FIT.
9. **Report.** After the final check establishes settled scope, flip `status: ready`; the driver writes the
   completion report from the recorded facts (`docs/backlog/README.md` §Report);
   relay it. No approval gate. Pushback before the first PICKUP re-fits in
   place; after a run started → explicit user amendment (`RDY-6`).

Done when `pnpm backlog:check` passes and every fit-time decision lives in
`goal.md`, `map.md`, or a ledger line.
