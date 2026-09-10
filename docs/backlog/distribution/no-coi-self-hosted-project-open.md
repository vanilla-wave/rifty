---
area: distribution
status: draft
title: Apply dependency snapshots and open actual saved no-COI files
created: 2026-09-10
why: SDK lacks the published snapshot consumer and refuses saved activation based on installation proof
epic: no-coi-self-hosted-project
blocked_by: [distribution/no-coi-worker-startup]
sources: [https://github.com/vanilla-wave/rifty/issues/327, docs/backlog/distribution/reference/no-coi-project-open-refine.md, ADR-0417]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/workbench/src/workers/no-coi-install-context.ts, packages/workbench/src/glue/dep-snapshot-application.ts]
---

## Context

Goal I3–I6. Current SDK has no artifact consumer; openInstallation requires a
trusted stamp and eagerly activates adapters. User rejected install-status
admission, including the proposed incomplete-install-required recovery. Exact
answer, native Node probe and independent decision check are in refine evidence.

## Question

First establish ordinary saved open with missing/pending/legacy proof and
missing/corrupt lock: source and independent Node execution remain available;
dependency/adapter errors happen at use, with no fake capabilities. Preserve
network-free/nonmutating open and existing registry-backed install behavior.

Then expose explicit application of the existing producer archive without a
browser registry/dummy URL. Reuse validation, bounded acquisition, replay cache
and payload overlay; no host parser, new installer, catalog wrapper or saved
completion ledger. Host calls application for initial creation or update; open
never infers an application from missing installation proof.

Default conflicts fail before effects; force overwrites conflicting targets
(including replaced-directory descendants), retaining other paths. Apply reports
its own settled success/failure; interruption may leave partial dependency files
without blocking ordinary open or forcing retry. Input validation and actual
storage recovery remain. ADR-0417 supersedes the narrower SDK gate policy.

PICKUP prepares traceable fault rows and REDs, including genuine native interrupted
apply → page recreation → local Node success/missing dependency failure → explicit
reapply. Packed producer/SDK/copied-worker Vite build, saved edits, same-ID force,
changed artifact and invalid-input/OPFS failure cases are required acceptance,
not claimed results of this refinement.

## Decisions

- 2026-09-10 — re-cut: prior grouping draft becomes this goal child; storage/deadline obligations move to no-coi-worker-startup, without weakening #328/#329.
- 2026-09-10 — user rejects persisted install-status admission; ADR-0417 replaces the earlier proposed forced-retry/rollback fork.
