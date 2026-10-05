---
area: runtime-js
status: ready
title: `vm.runInThisContext` / `Script` honour `lineOffset` and `columnOffset`
created: 2026-09-15
why: vitest's module evaluator (and vite-node 3) evaluate every transformed test module with `vm.runInThisContext(wrapped, { filename, lineOffset: 0, columnOffset: -N })`; rifty threw `NotImplementedError('vm.runInThisContext.columnOffset')` for any non-zero offset, so no test file can execute
user_story: As a test runner in the browser shell, I want my wrapped module's stack positions to report the original file's line/column, but today the offset options kill the run before any test executes
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts]
---

## User scenario

Goal I4/I5: vitest's evaluator runs every transformed test module through
`vm.runInThisContext(wrapped, { filename, lineOffset: 0, columnOffset: -N })`
(evidence §I6); today the first such call throws
`NotImplementedError: vm.runInThisContext.columnOffset` (main 51440931a).

## Context

Oracle (Node v24.16.0, host re-run 2026-10-05): offsets shift reported
positions RAW — no clamping: `columnOffset: -20` on a 1:1 frame →
`/virtual/mod.js:1:-19`; `lineOffset: 10, columnOffset: 5` (construction) on
`function f() {…}\nf()` → `at f (/virtual/mod2.js:11:28)`; `lineOffset: 3` →
`/v/b.js:4:1`; fractional offset → `RangeError/ERR_OUT_OF_RANGE`; Script
construction offsets apply, run-time offsets for a compiled Script are
ignored; negative `lineOffset` is accepted. Execution semantics unchanged;
only reported positions move. Carrier (resolved): positive `lineOffset` is a
physical newline prefix (real frame coordinates); column shifts (and negative
line shifts) ride an `Error.prepareStackTrace` dispatcher installed around the
run — frames of the script filename are shifted in the rendered stack, and
thrown errors materialise their stack while the dispatcher is installed.

## Acceptance

1. `runInThisContext(code, { filename, lineOffset: 0, columnOffset: -20 })`:
   a stack captured inside reports `filename:1:-19` for the script frame —
   raw shift, no clamping (`→ I4/I5`).
2. `new Script(code, { filename, lineOffset: 10, columnOffset: 5 })` +
   `runInThisContext()`: function frames report `filename:11:28` (physical
   1:23 shifted) (`→ I4/I5`).
3. `lineOffset: 3` alone shifts lines (`filename:4:1`); top-level frames carry
   no `eval` marker (`→ I4/I5`).
4. A fractional offset throws `RangeError/ERR_OUT_OF_RANGE` (`→ I4/I5` Node
   argument validation).
5. Zero-offset runs behave exactly as before (baseline; existing vm parity
   cases stay green) (`→ REV-2` named baseline).

## Parity cases

Node v24.16.0 oracle (executed 2026-10-05, output above). RED target:
`vm/run-in-this-context-offsets.case.ts` — failed today on the rifty side
with `NotImplementedError: vm.runInThisContext.columnOffset` (run before the
fix, 2026-10-05).

## Out of scope

- `vm.runInContext` with a non-zero `columnOffset` — engine-op frames are not
  visible to the host stack dispatcher; stays a named loud throw
  (`vm.runInContext.columnOffset`); positive `lineOffset` there works via the
  same physical prefix.
- `compileFunction` offsets — not on vitest's path.
- Errors captured inside but read AFTER the run returned — Node bakes offsets
  at compile; the dispatcher shifts reads during the run and materialised
  throws. Deferred-read columns are unshifted (documented edge, not on the
  claimed path).

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| invalid offset | `runInThisContext('0;', { columnOffset: 1.5 })` | loud `RangeError/ERR_OUT_OF_RANGE` (`→ I4/I5`) |
| dispatcher restore | an error thrown by the script | stack materialised while installed, `prepareStackTrace` restored after — no dispatcher leak into later stacks (unit test) (`→ REV-2` baseline) |

## Challenge

challenge: 2026-10-05 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); oracle re-executed on host 2026-10-05 (raw-shift semantics confirmed, incl. negative column display and eval-marker absence)

## Decisions

- 2026-10-05 — agent (PICKUP): carrier resolved — hybrid: physical newline
  prefix for positive `lineOffset` (baked, Node-real coordinates) +
  `Error.prepareStackTrace` dispatcher for `columnOffset` and negative line
  shifts (renders/shifts frames of the script filename; strips the host's
  `at eval (...)` marker to Node's vm frame form). No source-map registry
  involvement, no engine changes.
- 2026-10-05 — agent (PICKUP): `Script` construction offsets apply at
  `runInThisContext()`; run-time offset options are ignored for a compiled
  Script, as in Node.
