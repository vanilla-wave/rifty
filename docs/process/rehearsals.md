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
| door | whole-ready-goal hand-off → `rifty-goal` / `goal-run.js` | AGENTS.md:48; README.md:46-52 |
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
| handoff | stop → user → re-invoke; harness report → re-invoke | goal-run.js:4-5; `STOP-6` |

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

## Refine before implementation — regression suite, 2026-09-07

Narrow paper rehearsal, not product execution. Replay to the request's exit:
refine-only → reported preparation; authorized build → checks/Final/merge.
Keep the older matrix above as history; its ready-item/ready-goal entrances
did not test the reader deciding what to build. Entry conditions below are
modelled on real seeds, not claimed transcripts of those PRs.

Authorities: `.agents/skills/rifty-refine/SKILL.md` §§Research and challenge/Grill;
`docs/backlog/README.md` §§Challenge/Report; `stages/pickup.md` step 5;
`stages/fit.md` steps 7–8; `rules/readiness.md` `RDY-2`/`RDY-6`/`RDY-8`.
Check report timing/content, evidence before dependent choices, premise reuse,
unchanged authorization and the lightweight factual-capture path in each cell.

| Cell / seed | Persona / want | Required trace and exit |
|---|---|---|
| D / PR #306 | maintainer: ship known CI rule | missing proof → brief report → authorized edit/review/merge; no invented research |
| I / PR #253 | maintainer: repair observed defect | baseline/RED → report → repair/Final/merge; no new-plan critic merely for a repair |
| E / PR #275 | owner: implement ready item, show preparation first | preparation → report before first IMPLEMENT → build/Final/merge; no approval turn |
| F / PR #274 | maintainer: revise internal route after evidence | record re-cut → report material delta → authorized build/merge; no user mechanism choice |
| G / `epics/fault-honest-sw-preview` | owner: delegate the ready goal | reuse FIT report/premise → child proof/build/rechart → CLOSE/merge; no critic per child |
| H / `backlog/esbuild-wasm-twin-recut` (historical branch) | maintainer: check whether constraint remains | probe answers question → report conclusion → close unnecessary work; no invented plan |
| J / PR #241 | owner: amend scope, retain valid proof | research → actual user choice → record/report delta → changed proof/build/merge; no second consent |
| M / banked stdout-newline finding above | agent mid-slice: defer unrelated observation | honest capture rides host → host review/merge; no capture critic or separate user report |
| N / `service-worker/generated-sw-js-still-tracked-in-vcs` | user: record settled finding | dedup/update → short sourced report → docs delivery; no research/critic |
| O / `runtime-js/node-entry-runtime-binding-variant-coverage` | user: just file test gap | honest question/fact → brief report → docs delivery; no forced probe or build |
| T / `epics/cold-npm-install-speedup` | owner: choose after measurement | probe → informed dependent fork → record/report → preparation delivered; no inferred build authorization |
| V / `runtime-js/spawn-node-eval-arg` §Challenge | owner: choose new capability vs existing runner | evidence/early critic → informed choice → record/report; later authorized build reuses premise |

Baseline E: `750c4786f` PICKUP immediately continued IMPLEMENT, report timing
unspecified. N/O: backlog README exempted every captured draft from user report,
while the capture skill required one for user-facing work. T already worked:
research-before-forks was retained, not removed. V improves feedback timing,
not a prohibition against reconsidering scope in the old process.

Backfire cases: universal critic + report writer adds two contexts to N/O and
one to mid-task M; a report approval adds a user turn to already-authorized
D/I/E/F/G/J. Early V critique can avoid a second scope answer but costs one
extra context if the later premise check could have shared Contract+RED.
Move an already-separate critic earlier → no extra context. Reuse unchanged
premise, never remove required Contract+RED to pay for earlier feedback.

## Refine → FIT boundary — regression suite, 2026-09-12

Narrow paper rehearsal on the working tree of the refine→FIT fix (seed:
PR #333 refined an epic with the user present, closed every fork, left
`## Invariants` empty and `status: draft`, planned "FIT via `rifty-goal`
after merge" in a second session). Replay each cell to its exit; cite the
clause; `before` = text at `acf594da9`.

Authorities: `rifty-refine/SKILL.md` §3.6, §4 (lines 51, 55-68);
`stages/fit.md:3-9, 24-26, 33-34`; `docs/backlog/README.md` §Epic fit
:102-105, :111-118, §Report :144-146; `docs/process/README.md:49-52`;
`rifty-goal/SKILL.md:20, 25-28`; `rules/pr.md` `PR-3` :20-21;
`epics/TEMPLATE.md:30, 62-68`; `artifacts/map.md:9`; `RDY-6` 4 :124-126;
AGENTS.md:31
("epic missing tier/Invariants → fit it yourself"); unchanged: `RDY-1`,
`STOP-1a` (stops.md:15-18), stops.md:23-27 (§STOP-1 mid-run fog), `rifty-to-backlog`
§4 :44 / §5 :62-63, `stages/pickup.md`, `implement.md:18`.

Axes the seeds kept: size (item ↔ epic) · certainty (all forks closed ↔ a
user fork open) · origin (user in session ↔ agent-only / legacy hand-off) ·
timing (build now ↔ hand-off later, PR unmerged) · distance (product ↔ the
process text). Dropped: spread — every seed lands on "docs only".

| # | Cell / seed | Persona / want | Trace and exit (after) | Verdict after / before |
|---|---|---|---|---|
| R1 | epic · forks closed · user present / PR #333 `epics/ai-agent-mode-and-bench` | owner: "воскресить #111", then hand the goal off in one command | refine §4:56-58 → fit.md 4 (Invariants, tier) → 8 (one final check on the whole set) → 9 `ready` + report → on its branch, packaging `PR-3` → process README:39 hand-off → `rifty-goal`:21 PICKUP | **pass** / **fail**: refine §4 "ends with preparation" + §3.6 vs TEMPLATE:30 dual owner → Invariants empty; `rifty-goal` had no row for a draft goal dir (silence); FIT scheduled for a session without the user (fit.md:5 before), PR merge as a stage boundary (`PR-3`), "immediately runnable" (backlog README:101) not met. Tally before 2·0·4+2·~12·2·2; after 1·0·4·~12·1·1 |
| R2 | epic · one user question unanswered / `no-coi-sandbox-tier` FIT 2026-08-28 | owner: "не знаю пока", wants the question kept and nothing built on a guess | refine §3 grill → no answer → fit.md:24-26 goal stays `draft` (step 9 does not flip); §4: FIT resumes on the answer — in-session (§3) or at hand-off: `rifty-goal`:20 FIT, :25-28 ask the recorded `owner: user` question first, in-session, then FIT from step 1; packaging `PR-3` | **pass** / **fail** before: backlog README §Epic fit :111-113 let the question ride as `owner: user` fog in a `ready` goal → the autonomous run stops at `STOP-1a` mid-way; `rifty-goal` table had no draft-goal row |
| R3 | legacy ready single-file epic / `epics/embeddable-dev-loop.md` (no Invariants) | owner hands off "run embeddable-dev-loop" | `rifty-goal`:20 legacy → fit.md:7-9 FIT in the hand-off session, step 3 asks the user present → 9 `ready` → PICKUP | **pass** / pass (banked G); backfire re-rehearsed clean — no refine session required |
| R4 | agent-only epic capture — **invented** (pole origin=nobody asked × size=epic; captures on record are items) | post-merge audit agent finds a multi-item outcome | `rifty-to-backlog` §1-4 draft, §5:62-63 no interview → refine not entered (Preconditions:12) → own docs-only PR only with no branch (§4:44, `PR-2`) → user brings it → process README:47 refine → FIT then | **pass** / pass; the fix does not reach it |
| R5 | standalone item · same day / `playground/react-vite-starter` (created + Contract+RED 2026-09-02, PR #300) | maintainer: build the starter now | refine → §4:65-66 item `draft → ready` at PICKUP (`RDY-1`) → process README:48 → pickup.md 2 → Contract+RED → IMPLEMENT, one PR (implement.md:18) | **pass** / pass; backfire clean — §4:56 says "An epic" |
| R6 | mid-slice discovery / banked M `process.ts:659` | agent mid-slice | `rifty-to-backlog` §4:43-44 rides the unit branch (`PR-2`) | pass on routing; ceremony fail carried (banked M) |
| R7 | user "just file it" / banked O `runtime-js/node-entry-runtime-binding-variant-coverage` (epic variant: same clause) | user: record the gap, decide later | refine §3 "just file it → Formalize" → §4:58-60 goal stays `draft` → later `rifty-goal`:20 | **pass** / pass; backfire clean — FIT not forced |
| R8 | hand-off right after FIT, refine PR unmerged / PR #333 counterfactual "теперь запускай" | owner: start the run without a merge round-trip | refine §4 → `ready` on branch → process README:39 → `rifty-goal`:21 PICKUP → branch/PR choice: `PR-3` "one draft PR per goal by default; combine or split" | **pass** with named silence (which branch: driver's, principle `PR-3`) / same |
| R9 | the process text itself / this diff | maintainer: fix the text, rehearse, one PR | process README:48 authorized change, no minted draft (`PR-2`) → `RDY-8` docs checks + Final+GREEN → `pr:check` doc lanes | pass on routing; ceremony fail carried (banked B). Observed: `pr:check` 19/20 in a fresh worktree (`check:esbuild-legacy-retirement`: build outputs missing), 20/20 docs-only after `pnpm build:libs` |

Score (changed cells only). Before: R1 fails one-door (three texts answered
"who lands Invariants": refine §3.6, TEMPLATE:30, AGENTS.md:31), no-manual-
relay (merge → user re-hands off FIT → re-hands off the run), serialise-only-
where-it-buys (a merge wait before FIT), uncertainty-legible (an empty section
pointing at a stage nobody was scheduled to run), and the repo's own `PR-3`,
process README:41-42 "never return control between stages", fit.md:5 (before)
"the user is present", backlog README:101 "immediately runnable". R2 before: silence on the driver
path. After: 0 new fails; R6/R9 ceremony fails carried from the banked suite.

Constraint: preparation had two names — refine (an entry) and FIT (a stage) —
and the text keyed FIT's start to a hand-off, never to the user's presence;
so with the user in the room the driver stopped at the name boundary, shipped
a draft, and booked the user-needing half for a session without the user.
Explains R1 (all), R2 silence, the §3.6/TEMPLATE dual owner. Does NOT explain
R6/R9 ceremony (banked constraint: cost keyed to unit shape) or the legacy
`ready`/`in-progress` epics without Invariants (by design: FIT at hand-off, R3).

Decision 2026-09-12 (user): an unanswered user question ALWAYS keeps the goal
`draft` — `owner: user` fog removed from ready goals (README §Epic fit,
TEMPLATE, `RDY-6` 4, fit.md 3-4, `artifacts/map.md`); `STOP-4` mid-run fog
unchanged. A first cut of this fix let a child-only user question ride as
fog in a ready goal (fresh reviewer finding); rejected — it re-creates the
mid-run stop the fix exists to remove.

Backfire: R2 (unanswered question must stay `draft`) — fit.md 3, refine §4; R3 (legacy
without refine) — fit.md:7-9; R4 (agent-only never interviews) — refine
Preconditions:12 + `rifty-to-backlog`:62-63; R5 (items never FIT) — §4:56
"An epic"; R7 (just-file) — §4:58-60. All re-rehearsed clean. Residual silence:
R8 branch choice (agent path, `PR-3`).

## Canon delta Δ1–Δ8 — regression suite, 2026-10-13

Paper rehearsal of the proposed delta (`/tmp/shakedown/proposal.md`, kept out of
the repo) on the working tree (docs/process = origin/main, unchanged since
09-24). Seeds S1–S10 are the October runs: #353 Opus (13 children, 108 review
sessions, 15 598 record lines), glm-dir Sol 6.1 (11 units in one evening, 13 fix
waves / 38 h, u5 34 reviews, vitest never run), #368 Sol 6.1 (acceptance-first,
I1–I6 in 3 h, then a fake I7 gate + 12 ADRs), #351 Astra (54 h on four
questions, re-asked after compaction), #357/#359/#362/#364 Astra, #366/#367.
Measured: 160/219 reviewer blockers were real behavior defects; 118/219 demanded
a sweep / more RED beyond the cited row; `pass-binding.mjs:91` returns `ok` on
the first bound artifact (no per-unit cascade exists in code). Each cell was
walked BEFORE (today's text) and AFTER (delta applied); opus rehearsers, fable
scorer, both fresh contexts. Axes kept: size · spread · certainty · origin ·
distance; added: presence (user in the room ↔ absent for hours/days).

| # | Cell / seed | Persona / want | Before | After | What the delta did |
|---|---|---|---|---|---|
| A | tiny fix / #366 | maintainer, main red, green in 20 min | fail (3) | fail (3) | docs read 12→6; Δ8 "CI green before review" + Δ7 second run ≈ +35 min; binding still skips drafts (pass-binding.mjs:41) |
| B | docs-only / #367 | maintainer, 4 lines | fail (2) | fail (4) | Δ2 b3 makes a 1-line doc commit a JSON + CI; reviewer per line stays (Δ1 b1) |
| E | ready item adding a public SDK option / #359 child | agent | fail (3) | fail (3) | records 336 lines → PR; Δ3 DEC-2 line vs AGENTS.md:42 unedited; `adr:new` throws without the Index |
| I | post-CLOSE repair on an ADR seam / c9fbd0668 + ADR-0504 | agent, merged today | fail (1) | fail (5) | Δ1 STOP-3 turns the owner's real I9 defect into a stall; Δ2 one record vs the CLOSE verdict unstated |
| G | whole epic, 13 children / #353 | owner away two days | fail (5) | fail (6) | 15 598 record lines → 1 file; ceremony passes; u7 rounds 2–7 become NOTEs (Δ1 b2) |
| N1 | light-units-first, wall never reached / glm-dir | Sol 6.1 driver, overnight | fail (6) | fail (5) | Δ4 orders the carrier first (serialise passes); Δ5 deletes "no approach left → report the limit" |
| L2 | distinct real bugs of recurring classes over 7 reviews / Opus u7 | driver at round 3 | **pass** (0) | fail (9) | Δ1 diff-only verify + class stall lose 4 of 5 real parity bugs; Δ5 "commits reverted" |
| N3 | unbounded analyzer under review / glm u5 | driver at wave 4 | fail (4) | fail (3) | stall at wave 2 instead of 11; fault class of a static-guard bypass is a judgment (fault-classes.md:29-37) |
| N2 | wall needs the user's call, user absent / #368 I7, #351, #362 | driver at hour 4 | fail (4) | **pass** (0) | Δ5 one map line + PR post, run continues; Δ4 carrier first; fake throw named before review |
| M2 | sweep demand, one sibling really broken / glm wave 2, u7 | driver | fail (4) | fail (2) | REV-2 enforced; but the Worker sibling outside the FIX diff ships as a NOTE |
| N6 | internal mechanism, realm-wide substitution / #368 Buffer | driver | fail (3) | fail (6) | 3 ADRs in 4 h → 0, but nobody is mandated to challenge the mechanism; F5/F7 outside the 28-file diff |
| N7 | owner reviews the PR after 19/19 PASS / #357 | owner | fail (4) | fail (4) | Δ7 gives the finding a door (REV-12 observation); "why did review miss it" has no home either way |
| N10 | the process text itself / R9 + canon frozen since 09-24 | maintainer landing a lesson | fail (7) | fail (7) | docs read 13→5; "≤250" is a cap with no overflow; fold leaves 15 dangling refs, skills/recipe cite deleted files |

Score: property×cell fails 46 → 57 (34 newly failing, 23 newly passing); whole-cell pass 1/13 → 1/13 (L2 → N2). Gains: ceremony 9→3, lesson-paid-once 7→3, Simplicity 3→1, delete-on-done 1→0. Losses: findings-land-in-the-unit 0→6, STOP-3 "passes are not counted" 0→6, README:5 "one home" 1→5, re-cut-in-place 0→3.

Constraint (before): the process bills and binds by the record a stage emits —
a verdict file, an evidence file, an ADR, a blocker with an `authority` string,
a lesson line — never by who reads it next; so records pile up unread, a blocker
binds on form, a review ends only when the reviewer runs out of things to write,
and a lesson is paid again. Explains 39/46. Does not explain: N2 halt vs
continue (stops.md:27-29 vs README.md:59), N1 loop order (rifty-goal:11-13),
REV-8 binding skipped on drafts/docs (pass-binding.mjs:41,:46).
Constraint (after): Δ1 re-keys the verify pass and the stall to the shape of
the last FIX (its diff, its fault class) instead of to the obligation, and
Δ3/Δ5/Δ6 delete rule homes without editing the texts and tools that cite them.
Explains 40/57.

Delta verdicts (backfire-checked; cells each Δ was re-rehearsed against are in
the scorer's §6): Δ1 amend — keep both checkpoints and machine-checked blocker
admissibility; make `REV-7` Repeat (same class at one boundary → redesign) a
blocking authority; drop the diff-only verify, the fault-class STOP-3 and the
deletion of stops.md:42-50; edit review.md:145-146 so reviewers stop writing
"sweep siblings" into blockers. Δ2 amend — no `contract-red.json`, no
`evidence.md`; one landing verdict per PR *at merge* with LANDING_ARTIFACT_RE
and :91 unchanged; no pr-N rename. Δ3 amend — DEC-2 correction = dated line in
the owning ADR (edit AGENTS.md:42, adr README:3, refs/check, adr/new together);
keep "new mechanism" in DEC-1 p.4 (N6: the ≥2-candidate ADR was the only written
challenge to a mechanism born in a FIX). Δ4 keep minus "stays unpicked" (CLOSE
owes every invariant). Δ5 amend — keep the STOP-1 paragraph; keep "materially
different design", "no approach left → report the limit", "surviving letters
keep their places"; "commits reverted" → rechart.md 3 wording. Δ6 amend — one
file, no "≤250"; critic slot = disputed blocker or overturned decision; list the
out-of-docs/process edits. Δ7 amend — keep "done = merged on green PR CI at
HEAD; bot/review comments are REV-12 observations"; drop retries→0 and the
exact-bytes pin. Δ8 amend — diff-scoped local gate + `--all`; drop "review
needs CI green on the reviewed sha"; add the four local-only lanes to ci.yml
(pr-check.mjs:150,155,158,160) or drop "full set on CI".

Carried silences: binding skipped on drafts/docs (A, B); "why did review miss
it" (N7); nothing drains a process lesson (N10, 14 process-meta drafts);
rifty-fix:21 "touched gates" vs implement.md:13 "pnpm pr:check" (A).
