# PICKUP — compile and gate the next unit

Input: a draft unit — the goal's frontier child (`../artifacts/map.md`) or a
standalone item. Output: one ready unit with review membership; no
implementation started. Driver session (`DEC-5`).

1. **Choose.** The user-named unit, else the first frontier child. A legacy
   child already `ready` with no verdict line compiles here the same way; its
   trace additions ride a `re-cut:` line (`RDY-5`) and its Contract+RED
   verdict is committed like any other — `check:contract-drift` binds a
   `ready-verdict:` line added beside code to its artifact (`REV-8`).
2. **Compile** draft → ready per `../rules/readiness.md` `RDY-2`: evidence per
   row about the oracle and baseline only — nothing about the deliverable is
   measured here, a budget on it becomes a traced Acceptance row with a RED
   carrier; internal forks resolved yourself; a user-observable fork, or an
   `owner: user` fog line the unit depends on → `STOP-1a`: inside a goal the
   child leaves the path (demoted `draft`, fork verbatim, fog line — `STOP-4`
   3) and the run continues; a unit without a goal stops for manual
   `rifty-refine`. Never interview. A question draft answered "keep it" is
   declined, not compiled (`RDY-2` 5).
3. **Trace + intent** (`RDY-3`, `RDY-4`): every Acceptance/Parity/Fault row
   traced; one-sentence `title`; two intents → split (`RDY-5`), successors
   reference each other. No count gates.
4. **Membership** (`RDY-8`): `review: checkpoints | ordinary` in the unit.
   Open the draft PR at the first commit (`../rules/pr.md` `PR-3`).
5. **Contract+RED** — `checkpoints` units only — via `contract-red.md`
   (`checkpoint-run.md`). A split successor carrying only certified rows
   inherits (`RDY-5`). `ordinary` units skip it.
6. **Hand off.** Implementation is `implement.md`; this stage ends here.

Exits: done (a certified or `ordinary` unit); left-path (`STOP-4` 3);
`STOP-1a` outside a goal; declined (a standalone question draft, `RDY-2` 5 —
inside a goal a question is a fog line, never an `## Items` row). Done when verdict and membership are recorded and
no implementation has started — no product, template, fixture, lane or
harness code exists on the branch that the contract's REDs do not require.
