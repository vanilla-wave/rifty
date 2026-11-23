---
area: runtime-js
status: draft
title: ESM cycle failure is shared by every SCC member, and link errors use Node's text
created: 2026-10-25
why: an error thrown by a cycle's root leaves an already-evaluated cycle member importable where Node rejects it with the same error; link-error messages name absolute ids and one generic reason where Node names the specifier and the specific cause
user_story: As a developer whose ESM package graph has a cycle that fails during evaluation, I want a later import of any cycle member to reject with the same error as in Node, but today rifty hands back the member's namespace as if the graph had loaded.
blocked_by: []
sources: [ADR-0348, PR-158-salvage-probe-2026-10-25]
code: [packages/runtime-js/src/module-loader/esm-job-state.ts, packages/runtime-js/src/module-loader/esm-job-evaluation.ts, packages/runtime-js/src/module-loader/esm-job-linker.ts]
---

## Context

Salvaged from PR #158 (2026-07-19 audit draft); re-verified on main
`7d038adb0` against Node v24.16.0 (probes = uncommitted scratch vitest).
Most of the original draft is closed by the ADR-0348 job graph: link phase `linkPreparedGraph`
(`esm-job-linker.ts:192`) rejects missing named/default imports and
re-exports before effects; TDZ, star fixed point, ambiguity exclusion,
same-binding convergence, SCC order, sticky evaluation-error identity,
one-time bodies and top-level-await rejection (sync and in a cycle; probe
only, no test) match Node (`esm-job-regressions.test.ts`, parity
`modules/require-esm-cycle`, `modules/require-esm-evaluation-error`).

Residuals:

1. SCC failure propagation. `a.mjs`: `import './b.mjs'; throw new
   Error('a-fail')`; `b.mjs`: `import './a.mjs'; export const b = 1`.
   `import('./a.mjs')` then `import('./b.mjs')`: Node → b rejects with the
   same `a-fail` object; rifty → `{ b: 1 }` (same via `require`). Each job
   settles alone: `finishEvaluation` (`esm-job-state.ts:235`) marks b loaded
   before the root fails; `failEvaluation` (`:222`) records only the root.
2. Link-error text: one message for every cause
   (`esm-job-linker.ts:147-155`). Node: missing export names the request
   specifier (rifty: absolute id + `(imported by …)`); ambiguity →
   `contains conflicting star exports for name 'x'`; re-export-only cycle →
   `Detected cycle while resolving name 'x' in './b.mjs'` (rifty returns
   `null` at `:100`). TDZ `ReferenceError` names the export key
   (`esm-job-state.ts:283`) where Node names the importer's local binding.
3. Nested star ambiguity: V8 resolves `export * from './amb.mjs'` +
   `export * from './x3.mjs'` order-dependently (namespace `{x:3}`, named
   import throws naming `./amb.mjs`); rifty follows the spec
   (`esm-job-linker.ts:139`). Low value; record before claiming parity.
4. Repeat import after a link error: Node import path rethrows the cached
   error; rifty retries (ADR-0348 D1 "link failures remain retryable"). An
   ADR-0348 question, not this item's to flip silently.

Namespace reflection over TDZ bindings (`Object.keys(ns)`) is owned by
`runtime-js/cjs-esm-static-named-exports`. Compat `modules.md` "ESM cycles"
row is ⚠️ for residual 1 and the TDZ naming in residual 2.

## Question

Does one SCC owner settle all members together (Node's cycle-root
`[[EvaluationError]]`), and which link-error texts are in scope with it?
Settled at PICKUP with Node RED parity for residuals 1–2 (import and
`require` paths); 3–4 need a recorded decision before any parity claim.
