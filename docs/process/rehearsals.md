# Rehearsals — the process walked on paper

Banked suite. Re-run: walk each cell through the process as written, cite every
step's clause (`file:line`), record the tally, then report what NEWLY fails and
what NEWLY passes. A step with no clause is **silence**. Silence is a fail on a
path a machine executes (driver, gate) and wherever two principles give
different answers; on a path an agent executes it is a pass when the auditor
names, by id, the one principle the step follows from (`AGENTS.md` §Fidelity,
§Simplicity, `DEC-1`, `STOP-1`, `REV-2`, …) — a rule written for every case
is the failure mode this suite must not reward. Where a machine gate is
claimed to accept or refuse something, run it on a scratch fixture and cite
the observed exit.

Last run: 2026-09-06 (fourth pass), fresh-context auditor on the working
tree of the process re-cut (rounds/park/size-gate/tail/`proof-only` removed,
`contract-drift` cut to the graded contract, `blockers.mjs` axis renamed,
`goal-run.js` a pure sequencer). Previous: 2026-09-05 (c) 5/13; 2026-09-04
(`main` + PR #307, 0/13); 2026-08-31 (void, canon re-cut by #302).

## Map

| Kind | Thing | Clause |
|---|---|---|
| door | user-brought idea/finding → `rifty-refine` | AGENTS.md:31; README.md:52 |
| door | mid-task/agent discovery → `rifty-to-backlog` | AGENTS.md:31; README.md:52 |
| door | observed defect → `rifty-fix` (no doc, `review: ordinary` by construction) | AGENTS.md:31; rifty-fix/SKILL.md:3,8 |
| door | whole-ready-goal hand-off → `rifty-goal` / `goal-run.js` | AGENTS.md:47; README.md:48-51 |
| door | standalone item → the pickup ask, the session drives the stages | README.md:53-54; pickup.md:3-4; `RDY-1` |
| door | no-doc unit (docs, CHANGELOG, fix, CI rule) → own ordinary PR, nothing minted or journaled | `PR-2`; `RDY-8`; README.md:44-47 |
| door | "still load-bearing?" → question draft → PICKUP declines (§Declined row) or compiles retirement | backlog README §Shape; `RDY-2` 5; pickup.md |
| door | unreproducible red gate → one isolated rerun (`PR-6`) → reproduces: `rifty-fix`; cannot reproduce: draft + status | pr.md `PR-6`; rifty-fix/SKILL.md:12 |
| door | finding on a landed unit → defect `rifty-fix` / else `rifty-refine` | `REV-12`; rifty-to-backlog §1 |
| stage | FIT → PICKUP → Contract+RED → IMPLEMENT → Final+GREEN → RECHART → CLOSE | README.md §Stages |
| stage | reception FIX/REJECT/NOTE (critic at a checkpoint, driver inline on ordinary) | `REV-12`; checkpoint-run.md |
| stage | stall → one re-cut → leave the path as fog (`owner:` by trace), commits reverted, run continues | `STOP-3`/`STOP-4`; rechart.md 3 |
| stage | ordinary review: one fresh prose reviewer, inline reception, one verify | checkpoint-run.md §Ordinary review |
| gate | `backlog:check` · `check:contract-drift` (graded contract only) · `blockers.mjs` (`Scope` axis; rule-id rows dropped) · `refs:check` | README.md §Machine gates |
| gate | `pnpm pr:check`, lanes by diff class, `test:run` isolated rerun | `PR-6`; pr-check.mjs |
| gate | PASS binding: docs-only diff (`isDocumentationOnlyPath`) + unchanged graded contract (`itemContract`) | `REV-8` |
| handoff | driver → fresh reviewer per checkpoint / per ordinary review | `REV-11`; checkpoint-run.md |
| handoff | driver → fresh critic (reception), checkpoints only | checkpoint-run.md 2 |
| handoff | capture → fresh challenge critic; fresh report subagent for user-facing write-ups only | rifty-to-backlog §5-6 |
| handoff | stop → user → re-invoke; harness report → re-invoke | goal-run.js:6; `STOP-6` |

## Suite

Tally = turns · confirmations · fresh contexts · docs read · PRs · waits.

| # | Cell | Seed | Persona / want | Verdict 2026-09-06 (d) | 09-05 (c) | 09-04 |
|---|---|---|---|---|---|---|
| A | tiny bug · trivial · known | PR #272 | maintainer, main red, wants green in 20 min | **fail** on ceremony only — a `tests/` fixture runs all 24 lanes (two diff classes) and one fresh reviewer | fail | fail |
| B | docs change · trivial · known | PR #269 (4 CHANGELOG lines) | maintainer recording a shipped fix | **fail** on ceremony only — one fresh reviewer for four lines | fail | fail |
| D | CI/toolchain rule · trivial · known | PR #306 | agent turning a load-flake lesson into a rule | **pass** | pass | fail |
| I | follow-up from a review | PR #253 | agent repairing a finding on a merged PR | **pass** | pass | fail |
| E | small feature · thick · known | PR #275 | agent picking a standalone ready item | **pass** | fail | fail |
| F | feature · wide · settles | PR #274 | agent unifying one surface | **pass** | fail | fail |
| G | large epic · wide · settles | `epics/fault-honest-sw-preview` | user hands off a goal and walks away | **pass**, stall counterfactual included; silence: who re-invokes after a harness report (fixed after this run: the starting session) | pass / fail | fail |
| H | epic-scale · unknown until explored | branch `backlog/esbuild-wasm-twin-recut` | maintainer: "still a forcing constraint?" | **fail** on ceremony only — critic + reviewer for the question draft, a second turn, a reviewer for one §Declined row; refine cannot decline itself | fail | fail |
| J | ready item · live fork mid-build | PR #241 | agent hitting an `I#` fork after pickup | **pass** | pass | fail |
| K | flake · unreproducible | 2026-09-03 pr:check under load | driver needing a green gate | pass on the happy path; **fail** on the counterfactual — "does not land" had no exit in IMPLEMENT (fixed after this run) | pass / fail | pass / fail |
| L | real bugs after the budget is spent | 2026-09-04 dev-hmr, 5/5 HOLDS | driver at 03:40, no user | **pass** | pass | fail |
| M | defect outside the unit's boundary | `process.ts:659` stdout `\n` | agent mid-slice | pass on routing; **fail** on ceremony — a draft, a critic, a second PR and a reviewer for one byte; no trigger for the repair | pass / fail | pass / fail |
| P | proof-only successor | `no-coi-sandbox-package-install` | driver at PICKUP | **fail** under the driver — stale `ready-verdict:` lines on a draft read as state (fixed after this run: status first); pass on the session path | pass | pass / fail |

Invented cells: none. Whole-cell passes: 7 (D, I, E, F, G, J, L); 09-05 (c): 5; 09-04: 0.

## Score

| Property | Fails on | Trace |
|---|---|---|
| One door per intent | B, D (before wave 4: README routed a no-doc unit through a PICKUP that takes only a draft) | README.md §Stages; pickup.md:3 |
| Confirmation only where earned | G-cf (before wave 4: a carrier stall re-typed as `owner: user`) | `STOP-4` 3 |
| No manual relay | G, K, M | merge actor (now: the driver, `PR-3`/`DEC-3`); post-flake gate run (now named in rifty-fix 1); repair of a capture has no trigger |
| Ceremony proportional to size | A, B, M | two diff classes; one fresh reviewer per delivery; capture + critic + PR + reviewer for one line |
| Serialise only where it buys something | — | serial slices buy `BASE`; split PRs allowed |
| Start without a full spec | — | `RDY-1`; question drafts |
| Emergent design is a state | F (before wave 4) | `REV-8` re-cut binding |
| Re-cut in place | F, J (before wave 4) | same; demotion record form (now: any dated line with the row verbatim) |
| Uncertainty is legible | E, G, J, P (before wave 4) | standalone PASS line; legacy ready children; demotion record; ordinary coverage |
| Findings land in the unit that made them | — | `REV-12` |
| No second queue | K, M | drafts minted for a flake or a capture have no scheduled drain |
| A lesson is paid for once | F (before wave 4) | re-certification |
| **repo** "delete on done" | E (before wave 4) | final-green.md |
| **repo** "a stop names what the user decides that the agent cannot" | G-cf (before wave 4) | `STOP-4` 3 |
| **repo** spend never asks | — | holds |
| **repo** `REV-12` reception | A, B, I, M (before wave 4: no journal home for a no-doc unit) | checkpoint-run.md 2 |

## Constraint

**Cost and route are keyed to the unit's shape — doc / no doc, `checkpoints`
/ `ordinary` — never to the size of the delta or the nature of the fact.**
A no-doc unit always pays one PR + one fresh reviewer + a two-class lane set
(A, B); a one-byte discovery pays a draft + critic + PR + reviewer (M); a
probe-answerable question pays a critic, a reviewer, a second turn and a
second reviewer (H). Does NOT explain: drafts nothing pulls back but a user
ask (K, J, M); the driver reading an append-only journal as state (P, fixed
after this run). Everything the 2026-09-04 constraint named (goal-only
memory, enumerated ledger grammar) is gone.

## Numbers

- Cells 13. Whole-cell pass 7. Fail on some step 6 (A, B, H, M on ceremony;
  K-cf, P). Defects 20 (13 new, 7 carried); 11 fixed after this run
  (unaudited: driver state by status, `done`/`pass` per stage with sha,
  RECHART failures routed, ordinary stall = `STOP-3`/`STOP-4`, IMPLEMENT
  admits a no-doc unit and names the unlanded-red exit, binding vs
  delete-on-done, one workflow for a captured defect, flip gate "beside
  source", `RDY-5` ledger line inside a goal, harness re-invoke owner, empty
  coverage valid in `blockers.mjs`). Carried and left: adjudicated residuals
  never block; any historical `ready-verdict:` satisfies the flip gate;
  `in-progress` in `contract-drift` `GUARDED`; `codex exec` hardcoded;
  `verdict.md` omits `overall_verdict`/`merge_call`; a stopped branch's
  captures wait (`PR-1` vs `PR-2`); refine cannot decline a question itself.
- Tally (turns · confirmations · fresh contexts · docs · PRs · waits):
  A 1·0·1(+1)·5·1·3 · B 1·0·1·3·1·2 · D 1·0·1(+1)·6·1·2 · I 1·0·1(+1)·4·1·2 ·
  E 1·0·2–4·10·1·4 · F 1·0·2+N·10·1·≥4 · G 1·0·≥27·~15·1·≥12 · H 2·0·3–4·6·1·1–2 ·
  J 2·1·0·4·1·1 · K 0·0·0·1·0·1 · L 0·0·≥4·4·1·≥2 · M 1·0·2(+1)·5·+1·2 · P 1·0·1(+1)·3·1·2.
- 2026-09-04 for comparison: 13/13 fail, ~36 silences, fresh contexts up to
  ≈60 per successor (F) and ≈50 (G).
