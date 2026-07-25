---
area: runtime-wasi
status: draft
title: Kernel-worker WASI run-path drops cwd+stdin; two run-paths diverge on ADR-0049 semantics with no parity guard
created: 2026-06-13
why: In-process runWasi forwards caller-owned WasiOptions but kernel-worker runWasiInWorker reconstructs that shape by hand and omits cwd and stdin, so guests cannot observe the same cwd and input semantics across the two run paths and no parity guard exposes the drift.
user_story: As a dev running a WASI binary via `createWasiProcess`, I want the kernel-worker path to preserve the same cwd and stdin semantics as in-process `runWasi`, but today its hand-built WasiOptions drops both.
sources: [ADR-0038, ADR-0049]
code: [packages/runtime-wasi/src/worker-entry.ts, packages/runtime-wasi/src/wasi.ts, packages/runtime-wasi/src/process-handle.ts]
---

## Context

`runWasi` in `wasi.ts` passes caller-owned options directly to `Wasi`;
`worker-entry.ts` instead constructs
`new Wasi({args,env,preopens,stdout,stderr})` with no cwd or stdin.
`WasiProcessOpts` declares cwd and threads it into `spec.cwd`, but the worker
entry never reads it into the Wasi options, while stdin has no channel. A
single Wasi-options forwarding seam is missing, so the two paths drift.
Related to `runwasi-kernel-dispatch-wiring.md` (dispatch wiring), but that item
does not cover the cwd/stdin option-forwarding divergence or its parity guard.

## Options or Next

Thread the full WasiOptions (including cwd and a stdin channel) into
`runWasiInWorker` so the kernel-worker path matches the in-process path;
ideally forward one shape rather than reconstructing it. Add worker-path
conformance/parity cases for cwd and stdin so the two paths cannot silently
diverge. Coordinate with `runwasi-kernel-dispatch-wiring.md` to avoid
double-tracking.

## Reversibility

REVERSIBLE — backlog item; internal option-forwarding in worker-entry, no public API change. If a new stdin transfer channel for the worker realm is introduced it may warrant an ADR.
