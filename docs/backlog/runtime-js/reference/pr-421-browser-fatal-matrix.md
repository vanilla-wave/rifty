# PR #421 — browser-host fatal paths equal main (round 5 rollback proof)

Manager decision after external review round 5: Node's fatal report only in
the isolate guest (one switch, `installNodeFatalReport()` in
`packages/isolate-guest/src/guest/entry.ts`); on the no-COI SDK and the COI
Workbench every fatal path prints as main `11b9397ee`.

## The diff

`git diff 11b9397ee -- packages/runtime-js/src packages/workbench/src packages/kernel/src`
— every fatal-text change is behind `nodeFatalReportInstalled()`, which only
the isolate guest turns on:
- `builtins/process-lifecycle-events.ts` `fatalReportText`: main's
  `formatThrown` + `\n` unless installed (`NodeProcessExit.fatal`,
  `listenerThrew`).
- `builtins/node-entry.ts`: the eval terminal's text, the eval catch's
  `MODULE_NOT_FOUND` reshaping and `asNodePrintedError`'s `stack` (main's
  `formatNodeModuleNotFound`).
- `internal/event-loop-keepalive.ts`: the drain's non-Error rejection
  (`new Error(String(x))`) and the eval terminal's unhandled-rejection reason.
- `module-loader/loader.ts` `projectNodeEvalError`: the required-file early return.
- Byte-identical to main: `module-loader/errors.ts`, `ipc/no-coi-child-worker.ts`,
  `workers/node-entry-bootstrap.ts`, `workers/declared-gap-cause.ts`,
  `node-entry.test.ts`, `no-coi-project-command-exit.test.ts`, the kernel spec.

Not fatal-text, kept on every host: entry semantics (`require.main`,
`require.cache`, wrapper arguments, `import.meta.main`), native CJS line
numbers and the `Object.<anonymous>` name (the module wrapper), timer
callbacks as `Timeout#_onTimeout`, `util.inspect` getters/holes, the CJS
first-line class.

## The matrix (run 2026-11-23)

109 cells per host: kind (`Error`, subclass, props + `cause`, `null`, `42`,
string, object, `MODULE_NOT_FOUND`, `ERR_REQUIRE_ASYNC_MODULE`; CJS compile
error as a file) × origin (sync, timer, microtask, `nextTick`, rejection,
`'exit'` listener) × `node file` / `node -e`; no-COI SDK `project.run` and COI
Workbench shell. Tools: `pr-421-browser-fatal-matrix/` (copy
`matrix-programs.ts.txt` to `tests/browser-unit/fixtures/zz-matrix-programs.ts`
and the two specs next to it; run once in this tree and once in a
`git worktree` of `11b9397ee` with `MATRIX_OUT=<file>`, e.g.
`MATRIX_OUT=/tmp/m/head-nocoi.json pnpm test:no-coi tests/no-coi/zz-matrix.spec.ts`,
`MATRIX_OUT=/tmp/m/head-coi.json RIFTY_PLAYGROUND_PORT=5339 pnpm test:browser-unit tests/browser-unit/zz-matrix.spec.ts`;
then `node compare.mjs.txt nocoi|coi` with the four files in `/tmp/nf-r3/matrix/`).

Normalization (named, narrowed after the internal verify): served runtime
URLs → `<runtime>/packages/…:L:C`; user frames' line/column (the module
wrapper's line sharing) and `Object.eval` ↔ `Object.<anonymous>` (the wrapper's
name); `[eval]:L`. Frame names otherwise compared as printed.

| Host | Cells | Equal main | Differ |
|---|---|---|---|
| no-COI SDK | 109 | 102 | 7 |
| COI Workbench | 109 | 99 | 10 |

Internal verify (same day, 135 cells per host with 13 more kinds/origins —
dependency throw, getter prop, listener rethrow, handled listener, rejection
listener, throwing `stack` getter, cause chain, async function, `exitCode` then
throw, AggregateError, `undefined`, symbol, function — under the broad
normalization): 126 equal, 9 differ in one rifty-internal frame line.

All 7 differences per host are one rifty-internal frame line in the printed
`stack` (main also prints rifty's frames): a synchronous or rejected
`node file` error lacks main's `at Object.import (<runtime>/…/loader.ts)`
frame (6 cells), and a compile error shows `at importNodeMain
(<runtime>/…/node-entry-main.ts)` where main shows `at Object.import` / `at
runNodeEntry` (1 cell) — the main-module claim's call path; ADR-0445
2026-11-23 round-5 line: rifty's own runtime frame lines are not part of the
criterion (main prints them only as a leak). COI's 3 more: an error created in
a `-e` timer callback prints `at Timeout.eval [as _onTimeout] ([eval]:…)` where
main printed `at eval ([eval]:…)` (Node `at Timeout._onTimeout ([eval]:…)`):
the timer callback now runs as `Timeout#_onTimeout` with `this` the handle
(Node's semantics, every host), and V8 names an anonymous function of the
eval-compiled `-e` code `eval` — declared, compat process.md. External review
round 6 counts 9 such cells with the no-COI SDK result's `error.stack`; and
`throw this` in a timer callback throws the `Timeout` (Node prints the timer
object, main `[object DedicatedWorkerGlobalScope]`, HEAD `Error: 1…` /
`Uncaught 1`) — the same exception. Every other cell: equal main.
