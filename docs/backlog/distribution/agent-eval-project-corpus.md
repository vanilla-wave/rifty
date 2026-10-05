---
area: distribution
status: ready
title: Evaluate real project changes and apps built from different starters
created: 2026-09-15
why: Five tasks in two ready-made templates do not cover the requested project and application-building workflows.
epic: agent-code-quality-evaluation
sources: [ADR-0434, docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md]
code: [tools/agent-bench/src/tasks.ts, tools/agent-bench/src/judge/context.ts, tools/agent-bench/tests/native-judge-controls.ts]
---

## Context

Current tasks hardcode one React issue-tracker and one Hono app. Add a finite,
versioned corpus covering fixes/features in multiple real JS/TS projects and
apps built from descriptions on different minimal installed starters (I1).
Select exact snapshots at PICKUP, before model measurement; no external
benchmark dataset or framework choice has been accepted as a requirement.

Existing judges see only the preview (`JudgeContext.previewUrl`, DOM/HTTP);
no lane runs a project's test suite or CLI as a judge, the COI lane exposes
seed/export/metadata hooks only (ADR-0434 §2) and Vitest 2.1.9 cannot install
in Rifty (legacy-esbuild ceiling, `reference/agent-bench-baseline-results.md`).
Own-environment judging of real-project bugs/features and CLI/library cases
needs a command-result judge inside each lane; without it such cases are
unevaluable in Rifty because of the judge, not the agent.

Requirements and regression checks judge observable results in each originating
environment (I3). Independent functioning and broken controls validate judges;
agent-visible files cannot replace the trusted checks. Preserve comparable
starting state, actual dependency provenance and per-lane coverage. Unsupported
capability and failed preparation stay visible; filtering out difficult model
results cannot manufacture the corpus. No empty-project generation promise.

## Corpus route

1. Probe the judging substrate before curation: which test runners/versions
   install and run in COI and no-COI; how a test-suite or CLI result is
   captured inside each lane. Choose bug/feature projects whose regression
   suite runs in each selected lane, or record that lane as unsupported for
   the case up front. This gate precedes every candidate.
2. Curate six different pilot candidates: two bugs, two features, two starter
   apps. Cover distinct engineering problems, not six versions of UI CRUD.
3. Bugs/features: real issue/PR and pre-change project snapshot, one
   package-lock v3 installed by every lane, retained regression suite. Record
   provenance; avoid leaking the reference patch into the agent's task/context.
   A public issue alone proves neither difficulty nor freedom from
   model-training contamination.
4. Starter apps: original product descriptions covering a linked user workflow
   on different installed minimal starters. Required behavior is explicit;
   implementation shape remains open.
5. Validate case cards and judges before expansion: unmet-task control fails,
   functioning reference passes on native, plausible partial solutions fail,
   alternative correct implementations pass. Run reference solutions in every
   selected environment and retain unsupported/failure evidence; reference
   failure in Rifty never licenses dropping the task from a chosen matrix.
6. Review pilot trajectories and checks for triviality, ambiguity, flaky judges
   and coverage gaps; record per-case authoring cost. The I5 campaign runs
   on the pilot version frozen and family-split by step 7. Expansion toward
   roughly 20–30 scored cases is a separate slice with its own frozen version
   and campaign, documenting selection reasons. Complexity comes from
   diagnosis, interacting behavior and preserving contracts; no minimum
   file/line/tool-call count.
7. Separate calibration and evaluation by related task families; freeze the
   corpus/version/selection rationale before comparative runs. Keep the five
   existing smoke/regression tasks separately reported. Any later correction
   retains old evidence and identifies the changed corpus/judge version.

This is the agent-owned route for I1/I6/I7, compiled at PICKUP. Counts and the
suggested app-heavy mix are estimates, not substitute acceptance or user quotas.
No pilot, new reference solution or live task has been executed during refine.

## Case card

- Origin: real issue/PR or original scenario; pinned project/starter and one
  package-lock v3 installed by every lane; per-lane install result.
- Task: exact agent request and starting state; no solution hints.
- Required behavior and existing behavior that must remain; inspectable checks.
- Difficulty: distinct diagnostic/interaction/compatibility problem; task family.
- Controls: reference, baseline and plausible partial solutions; commands/results.
- Environment evidence: reference outcome per lane, failure reason or unknown.
- Selection: pilot findings, calibration/evaluation family and version rationale.
- Boundary-study eligibility: meaningful next difficulty/pressure level and
  changed dimension, where applicable; selected diagnostic cases retain that
  provenance and do not replace the representative corpus (I11).

Checks are trusted independently of agent-editable files. Hidden input data is
allowed; hidden requirements are not. New apps must admit different working UI
structures; selectors cannot impose an unstated CSS class or layout (I6).

## Candidate examples

Illustrations, not selected repositories or promised exact tasks:

| Group | Candidate | Distinct pressure |
|---|---|---|
| Bug | Stale search response overwrites newer filters/pagination | Locate cause and reconcile existing state |
| Bug | Multi-file CLI/library mishandles excludes and partial errors | Understand foreign code and preserve invocation contracts |
| Feature | Bulk record changes across pages with error recovery | Selection, counts and data must agree |
| Feature | Add filtered stable pagination to a Node API | New behavior preserves old callers |
| App | Import → validate/correct → save → filter → export | Data stays consistent through a complete workflow |
| App | Markdown knowledge base with preview/links/search/save | Connected capabilities on another starter |

## Challenge

challenge: 2026-10-05 — clear; fresh `/root/corpus_judge_premise` reads original goal/refine authority. Trusted plain-assert semantic judges permitted, upstream tests/licenses retained and fixture mapping explicit; original runner gaps not claimed fixed. Counts estimates, no user fork.

## Acceptance

1. Frozen pilot-v1 has six distinct cards (2bugs/2features/2apps), real pinned project/issue provenance or original installed-minimal-starter scenario; one v3 lock per case in every lane. Input/judge/prompt/lock hashes visible; agent seeds contain no reference/partial/alternative/trusted judge files. `corpus-plan.test.ts`, source trees/cards. → I1+I6+I7
2. Both workload kinds run through the same existing series owner in all four lanes, actual COI +chat/packed SDK/native Pi/native Codex; command judges run trusted checks only after agent work in the originating host, capture physical exit/output and never rescue via Node. Setup/judge/unsupported failures retain records. Real reference controls plus corpus series proof. → I2+I3
3. Trusted checks preserve stated functional/regression requirements, reject baseline and plausible partial, accept reference and working alternative. Retained upstream fixture mapping; native24 control outcomes and every reference in all4 lanes, failures included. → I6
4. Family split is frozen before quality measurement: both ms cases calibration, evaluation serialization/async queue/contact import/linked notes. After reviewed pilot, expand to a finite versioned evaluation corpus with selection/cost rationale; no result-selected exclusions, original smoke separate. → I1+I7

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| corrupt-input × corpus/card/lock/hash | reject before series, preserve source | corpus-plan/loader validation tests | → I1+I7 |
| provenance-lie × trusted judge files | private check bytes injected after agent, no agent-edited check replacement | same-origin command receipt + seeded tree checks | → I3+I6 |
| sibling-drift × control/origin | same requirements/control across4 real adapters; failures retained | all-origin reference controls | → I3+I6 |

## Out of scope

Repairing node:test/Tape/Mocha/runtime gaps is not corpus admission. Their observed
failures remain visible; semantic assertions never imply those runners passed.
No hidden requirements, patch hints, subjective UI/style score or generated success.

## Decisions

- 2026-10-05 — substrate first:13 directed operations/native Pi/COI+chat/packed noCOI; plain assert pass/fail captured0/1; browser node --test9, Tape pipe error (worker replaced in noCOI), Mocha getter/exports error. Native runners succeed. Evidence retained separately from scores.
- 2026-10-05 — cards source exact upstream tests; trusted semantic fixtures carry API obligations without mocking Tape/Mocha. p-limit timing-window perf assertions not a functional requirement; concurrency/order/args/errors/ALS remain checked.
- 2026-10-05 — native library controls16/16 and app controls8/8: unmet/partial fail, reference/alternative pass. CSV alternative uses downloadable output/different storage, demonstrating accepted export choice; linked notes HTML safety/persistence/navigation checked.
- 2026-10-05 — cold case authoring includes input lock/source, mapped regressions, at least4 controls and4-origin reference proof. Expansion estimate eight total/six evaluation (four app families) remains route until pilot review; counts do not close I11.
