---
area: runtime-js
status: draft
title: Diagnose Workbench close failure after npm tarball 404
created: 2026-09-13
why: a failed real npm install returned exit 1 and later commands still ran, but Workbench close rejected with owner exit 1 carrying the old tarball rejection
sources: [https://github.com/vanilla-wave/rifty/pull/299, docs/backlog/runtime-js/invocation-scoped-unhandled-rejection.md]
code: [packages/workbench/src/workers/workbench-owner-runtime.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/npm-client/src/registry.ts]
---

## Question

Does an acquisition rejection remain attributed to the owner lifetime after its
npm invocation has already reported exit 1? Identify the actual settlement owner
and compare the prior baseline before choosing a fix. Related no-COI eval/run-bin
capture is linked above; shared root cause is not established.

Observed during PR #299's public T prototype, before the missing fixture route
was added: first snapshot open and offline reopen succeeded. Real post-init
`npm install @gravity-ui/icons@2.18.0 lodash@4.18.1 lodash-es@4.18.1 dom-helpers@5.2.1 react@18.3.1`
received HTTP 404 for `/registry/ms/-/ms-2.0.0.tgz` and returned exit 1 with
`npm: install failed: Failed to fetch tarball: 404`. A later T-verification Node
program still returned exit 0. Closing then rejected with
`Workbench owner exited (code 1, signal null)`, carrying the same rejection:
`RegistryClient.getTarball → fetchAndUnpackToCache → Semaphore.run`.

Repro entry: public-scale fixture; serve that one ms tarball path as 404 before
install, then run the T verifier and close. Positive fixture now serves all real
archives and passes. No live-owner crash, regression attribution, persistence
loss, or repair is claimed. Fault class candidate: invocation-error attribution;
pickup owner: runtime lifecycle, triggered by this capture.
