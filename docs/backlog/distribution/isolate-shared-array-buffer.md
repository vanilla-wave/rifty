---
area: distribution
status: draft
title: Let callers select shared buffer access per guest
created: 2026-11-19
why: Services need different guest policies on the same worker.
epic: isolate-host-shared-array-buffer
---

## Context

ADR-0557, ADR-0558 and ADR-0563 establish the two public entry points and shared warm workers. Node v24.16.0, isolated-vm 7.0.2: even with V8's per-context SAB constructor flag the buffer of shared wasm memory has the native SharedArrayBuffer brand.

## Acceptance

- Fixed and growable global construction, wasm JS memory and wasm exports refuse buffer access with NotImplementedError naming isolate-host.SharedArrayBuffer. Runtime-returned views expose ordinary backing stores and ordinary ArrayBuffer constructors through their prototype chains. → I1
- The packed README embedder restricts a fresh context and retains its default. → I3

## Reference contract

Compare to the running Node 24 executable via nodeEval. With an ordinary Int32Array, wait and waitAsync throw TypeError, notify returns zero and store/load work.

## Parity cases

- Unrestricted fixed/growable buffers and shared wasm memory match live Node. → I2
- Under restriction, ordinary wasm memory, buffers and Atomics on ordinary views match live Node. → I1

## Fault matrix

- Sequential and overlapping opposite policies on one warm worker retain their own policy. → I2
- A lost worker's solo retry retains the call's policy. → I2

## Out of scope

- Closing cross-tenant side channels or coarsening timers.

## Decisions

- ADR-0566.
