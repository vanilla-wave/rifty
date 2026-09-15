---
area: distribution
status: draft
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

Requirements and regression checks judge observable results in each originating
environment (I3). Independent functioning and broken controls validate judges;
agent-visible files cannot replace the trusted checks. Preserve comparable
starting state, actual dependency provenance and per-lane coverage. Unsupported
capability and failed preparation stay visible; filtering out difficult model
results cannot manufacture the corpus. No empty-project generation promise.

## Corpus route

1. Curate six different pilot candidates: two bugs, two features, two starter
   apps. Cover distinct engineering problems, not six versions of UI CRUD.
2. Bugs/features: real issue/PR and pre-change project snapshot, pinned
   dependencies and retained regression suite. Record provenance; avoid leaking
   the reference patch into the agent's task/context. A public issue alone
   proves neither difficulty nor freedom from model-training contamination.
3. Starter apps: original product descriptions covering a linked user workflow
   on different installed minimal starters. Required behavior is explicit;
   implementation shape remains open.
4. Validate case cards and judges before expansion: unmet-task control fails,
   functioning reference passes on native, plausible partial solutions fail,
   alternative correct implementations pass. Run reference solutions in every
   selected environment and retain unsupported/failure evidence; reference
   failure in Rifty never licenses dropping the task from a chosen matrix.
5. Review pilot trajectories and checks for triviality, ambiguity, flaky judges
   and coverage gaps. Expand toward roughly 20–30 scored cases, documenting
   selection reasons. Complexity comes from diagnosis, interacting behavior and
   preserving contracts; no minimum file/line/tool-call count.
6. Separate calibration and evaluation by related task families; freeze the
   corpus/version/selection rationale before comparative runs. Keep the five
   existing smoke/regression tasks separately reported. Any later correction
   retains old evidence and identifies the changed corpus/judge version.

This is the agent-owned route for I1/I6/I7, compiled at PICKUP. Counts and the
suggested app-heavy mix are estimates, not substitute acceptance or user quotas.
No pilot, new reference solution or live task has been executed during refine.

## Case card

- Origin: real issue/PR or original scenario; pinned project/starter/dependencies.
- Task: exact agent request and starting state; no solution hints.
- Required behavior and existing behavior that must remain; inspectable checks.
- Difficulty: distinct diagnostic/interaction/compatibility problem; task family.
- Controls: reference, baseline and plausible partial solutions; commands/results.
- Environment evidence: reference outcome per lane, failure reason or unknown.
- Selection: pilot findings, calibration/evaluation family and version rationale.

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
