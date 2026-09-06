# IMPLEMENT — RED → GREEN inside the contract

Input: a unit with `ready-verdict:` or `review: ordinary`, or a unit with no
doc (`RDY-8`: a fix, a docs change).
Driver session (`DEC-5`). Expected RED is not a defect — `rifty-fix` repairs
observed failures, never planned RED. Re-entered on an already GREEN tree
(a re-invoked run): nothing to build, go to step 4.

1. Expected RED first (the certified tests; a fix's own RED), then the smallest honest
   mechanism to GREEN (`AGENTS.md` §Simplicity, §Fidelity). Stay within the
   contract; a discovery that changes it → re-cut in place
   (`../rules/readiness.md` `RDY-5`), never a fresh start. Budget rows (cold
   start, lane time) are proven here by their RED; a breach on a row traced
   to `I#`/`scenario` is not the agent's to relax → `STOP-1a`; a carrier
   choice (which CI lane) is the agent's, one `## Decisions` line.
2. Classify every discovery against the frozen goal/tier/Fidelity: required
   → reverse-linked draft child (`rifty-to-backlog` shape, `## Challenge`);
   outside → `rifty-to-backlog`, or a defect repaired at once as its own unit
   (`rifty-fix`). Never narrow the goal or detach required work.
3. Append ledger lines for decisions and observations; run-state stays out of
   the contract (`RDY-4`).
4. `pnpm pr:check` green — under Codex escalated from the first attempt
   (`../traps.md` codex-sandbox-listen-eperm); a `test:run` red that
   reproduces in its isolated rerun, or any other red lane, is an observed
   defect (`rifty-fix`), never a retry loop. Commit
   (short one-line subject); push; tree clean. Open the draft PR if absent
   (`../rules/pr.md` `PR-3`); update its body (goal, carried slices).

Exits: done; left-path (a traced row the implementation cannot meet —
`STOP-1a` inside a goal, `STOP-4` 3); a red gate that resists diagnosis
(`rifty-fix` 1) — the unit does not land, one `STOP-6` report, the finding
draft its named residual. Done when the tree is clean, gates are green, and
every discovery is classified.
