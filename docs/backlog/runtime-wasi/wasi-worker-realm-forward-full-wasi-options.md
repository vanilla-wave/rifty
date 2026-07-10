---
area: runtime-wasi
status: draft
title: Kernel-worker WASI run-path drops cwd+stdin; two run-paths diverge on ADR-0049 semantics with no parity guard
created: 2026-06-13
why: In-process runWasi forwards cwd+stdin+preopens but kernel-worker runWasiInWorker reconstructs WasiOptions by hand and omits cwd and stdin, so the worker path cannot satisfy esbuild (no cwd->fd3 hoist, no stdin transform) — the precise failures ADR-0049 documents as fixed — and no test pins worker-path parity, so the drift is invisible.
user_story: As a dev running esbuild (or any WASI binary) via `createWasiProcess` on the kernel-worker path, I want the same cwd-hoist and stdin transform the in-process path gives, but today `runWasiInWorker` rebuilds `WasiOptions` by hand and drops cwd+stdin — so the worker path hits the exact esbuild failures the in-process path already fixed, with no parity guard catching the drift.
sources: [ADR-0038, ADR-0049]
code: [packages/runtime-wasi/src/worker-entry.ts, tools/shadow-registry/src/esbuild-transform.ts, packages/runtime-wasi/src/process-handle.ts]
---

## Context

esbuild-transform.ts `transformWithEsbuild` (in-process runWasi) passes cwd+stdin+preopens; worker-entry.ts:146-156 constructs new Wasi({args,env,preopens,stdout,stderr}) with no cwd or stdin. WasiProcessOpts declares cwd (process-handle.ts:62) and threads it into spec.cwd (:114) but worker-entry never reads it back into the Wasi options, and stdin has no channel. A single Wasi-options forwarding seam is missing — the shape is rebuilt by hand instead of forwarded as one object, so the paths drift. Anyone wiring createWasiProcess for esbuild (M8 goal) hits ADR-0049's documented failures. Related to runwasi-kernel-dispatch-wiring.md (dispatch wiring) but that item does not cover the cwd/stdin option-forwarding divergence or its parity guard.

## Options or Next

Thread the full WasiOptions (incl. cwd + a stdin channel) into runWasiInWorker so the kernel-worker path matches the in-process path; ideally forward one WasiOptions shape rather than reconstructing it. Add a worker-path conformance/parity case pinning ADR-0049 D1 (cwd hoist) + D5 (stdin) so the two run-paths can't silently diverge. Coordinate with runwasi-kernel-dispatch-wiring.md to avoid double-tracking.

## Reversibility

REVERSIBLE — backlog item; internal option-forwarding in worker-entry, no public API change. If a new stdin transfer channel for the worker realm is introduced it may warrant an ADR.
