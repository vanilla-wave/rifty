---
area: runtime-js
status: parked
title: Real-Node `MODULE_NOT_FOUND` shape for a missing `node <file>` entry
created: 2026-06-20
why: a missing entry is pre-checked by resolveNodeEntry (existsSync) which returns a terse single-line `node: cannot find module '<abs>'`; real Node prints a multi-line `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND', requireStack: [] }` (exit 1). The terse form is honest (compat ⚠️) but not byte-faithful.
user_story: As a developer running `node ./nope.js`, I want the same multi-line MODULE_NOT_FOUND error + code that real Node emits, so error-matching tooling behaves identically.
sources: [ADR-0154, ADR-0157]
code: [apps/playground/src/workers/node-entry-resolve.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/kernel/src/worker-entry.ts]
---

## Context

`node-entry-resolve.ts` absolutizes the arg + `fs.existsSync` pre-check, returning
`{ ok:false, message: "node: cannot find module '<abs>'\n" }` on a miss; the `node`
command writes that to stderr + exits 1 (`real-vite-bootstrap.ts`), so the module
loader is NEVER reached for a missing ENTRY. The loader DOES have a real
`MODULE_NOT_FOUND` path (`resolver.ts` throws `ModuleLoadError('MODULE_NOT_FOUND', …)`),
but it only fires for nested import/require inside an entry that exists, and even then
the surfaced text is rifty's `ModuleLoadError: Cannot find module '<spec>' (imported
from …)` — not Node's `Error … { code, requireStack }`. compat `process.md` marks the
row ⚠️ (intentional simplified shape); `node-entry-resolve.test.ts` pins the deliberate
form (not parity).

## Options or Next

OPTION A (full fidelity): make the LOADER the single producer of the entry-miss
diagnostic. (1) Drop the `existsSync` pre-check string (keep cwd absolutization + the
empty-arg usage message) so a missing entry flows into `runNodeEntry` → resolver
`MODULE_NOT_FOUND`. (2) Add a Node-error formatter at the worker stderr seam
(`kernel/worker-entry.ts` surfaces a throw as `${err.stack ?? err.message}`): when
`err.code === 'MODULE_NOT_FOUND'`, emit `Error: Cannot find module '<abs>'` + (only if
`requireStack` non-empty) a `Require stack:` block + a `{ code:'MODULE_NOT_FOUND',
requireStack: [...] }` tail (for a top-level entry miss `requireStack` is `[]`, no block).
Code-gate it so the generic-throw path stays `${err.stack}` (RED-test that). Needs a parity
test diffing rifty stderr vs captured Node v24 output (a real fixture, not a self-assert),
and a decision on which Node-internal loader frames are load-bearing vs deliberately omitted.

## Reversibility

REVERSIBLE — diagnostic-text fidelity + a parity fixture; no public API or wire change.
Recorded; compat ⚠️ row in `docs/public/compat/process.md`.
