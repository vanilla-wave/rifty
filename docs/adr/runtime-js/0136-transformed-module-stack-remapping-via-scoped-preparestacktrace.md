# ADR 0136: Transformed-module stack remapping via scoped prepareStackTrace

Status: Accepted
Date: 2026-06

> TL;DR: Remap error stacks of esbuild-transformed `.ts` modules to original lines by decoding the inline sourcemap + composing it with the ESM-rewrite line map, applied through an `Error.prepareStackTrace` dispatcher installed ONLY while a mapped module's factory executes.

## Context

TS-on-import (ADR-0052) runs esbuild-WASI `--loader=ts`; the ESM AST rewrite (ADR 0009) then shifts lines again. Users see stacks pointing at transformed/wrapped code, not their `.ts` source. Need original-line frames without shipping a sourcemap library.

Options:

1. Permanent global `prepareStackTrace` hook — remaps every error, but a runtime-wide global footprint + interferes with host/devtools and other hooks for non-guest errors.
2. String-rewrite `err.stack` at loader catch sites only — misses user-caught errors (`try/catch` in guest code reads `e.stack` before the loader sees it).
3. **Scoped dispatcher (chosen):** install `prepareStackTrace` while a mapped module's top-level factory runs (`withStackRemapping`), stack of active maps, restore previous hook when idle; remap = `id:line:col` string substitution via decoded VLQ mappings composed with the esm-ast `lineMap` and the V8 `new Function` wrapper offset (4 lines).

## Decision

Option 3. Hand-rolled VLQ decode (lines+columns; 1-field segments advance the running column), per-id `SourceMapRegistry` owned by the loader, evicted with the transform caches on `invalidate`. Malformed inline maps degrade to unmapped stacks (DX layer must not fail module load). Hook install/restore is overlap-safe (identity-checked) for concurrent module evaluation.

## Consequences

- Original-line frames for throws during module evaluation; verified head-to-head vs `tsx` (parity case `modules/ts-stack-remap`).
- Remap window is top-level evaluation ONLY — frames rendered later (exported handler throwing at request time) stay unmapped; tracked with worker/overlay residue in `docs/backlog/runtime-js/worker-stack-remap-error-overlay.md`.
- Line offset 4 couples to V8's `new Function` rendering — fine for the Chromium-only target (D-001), wrong elsewhere.
- No external sourcemap dependency; decoder stays subset-honest (no `sources`/`names` resolution, only line/column lookup).
