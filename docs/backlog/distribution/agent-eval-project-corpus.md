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
