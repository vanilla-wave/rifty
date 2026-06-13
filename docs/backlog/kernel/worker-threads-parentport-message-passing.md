---
area: kernel
status: active
title: worker_threads real-Worker branch never wires parentPort — cross-isolated host loses message passing, degrades to stdout-only
created: 2026-06-13
why: startViaKernel() (the isSabIpcSupported() real-Worker branch) spawns the kernel Worker but never wires worker-side parentPort/workerData, so in a properly cross-origin-isolated host (the production target) worker_threads silently loses its core feature; only the same-realm dev fallback does real parentPort round-trips.
sources: [ADR-0011, ADR-0019]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

worker_threads.ts:74 comment: 'Phase 3 will wire worker-side parentPort; until then surface binary stdio as stdout/stderr events for debug visibility.' So the ONLY branch with real parentPort.postMessage / worker.postMessage round-trips is the same-realm fallback (lines 93-107). Net: in a cross-origin-isolated host the 'real Worker' is less functional than the fallback for the API's main purpose — a dishonest seam. Compounds ADR-0019's divergence where the worker-backed path also hardcodes cwd:'/workspace' (line 70) instead of inheriting the parent ProcessRecord.cwd. Existing kernel backlog (real-worker-threads.md, process-equals-web-worker.md) cover Worker-as-process modelling but not specifically the unwired parentPort messaging defect.

## Options or Next

Wire worker-side parentPort + workerData over the kernel Worker channel in startViaKernel so postMessage round-trips work in the isolated path (mirror the same-realm contract). Inherit the parent ProcessRecord.cwd instead of hardcoding '/workspace'. Failing conformance first: spawn a real Worker, post a message both directions, assert delivery (and workerData visible). Check overlap with real-worker-threads.md to avoid double-tracking the Worker-as-process portion.

## Reversibility

REVERSIBLE — backlog item; internal wiring of the existing real-Worker branch, no public worker_threads API change. The message-frame format over the kernel channel, if new, may warrant an ADR.
