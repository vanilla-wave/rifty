---
area: runtime-js
status: draft
title: "A fatal report prints Node's ReportFatalException shape: source header, inspected error, non-Error hint and `Node.js` trailer"
created: 2026-11-18
why: rifty prints a fatal error as its `stack` (no-COI `formatThrown`; kernel child `stack ?? message` / `String(value)`), so Node's `<file>:<line>` header, inspected props and non-Error forms, `--trace-uncaught` hint and `Node.js vX` trailer are missing on every host, and the two formatters disagree on non-Error values
sources: [docs/public/compat/process.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, tests/no-coi/no-coi-fatal-stderr.spec.ts]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/kernel/src/worker-entry.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

PR #406 outside findings 5, 6, 8, 10 and its COI-path residuals. Node v24.16.0
owners (read in the v24.16.0 source): `src/node_errors.cc` `ReportFatalException`
→ `AppendExceptionLine` → `GetErrorSource` (header), the stack through
`lib/internal/errors.js` `fatalExceptionStackEnhancers.afterInspector`
(`inspect(error, { customInspect: false })`), the non-Error hint, then
`\nNode.js <version>` (`extra_info_on_fatal_exception`).

Probes 2026-11-18, `node` v24.16.0 in a scratch dir (paths → `<root>`):

| program | Node stderr (abridged) | rifty no-COI command (P = pinned residual in `no-coi-fatal-stderr.spec.ts`; C = code read) |
|---|---|---|
| `fail.cjs` `throw new Error('boom')` | `<root>/fail.cjs:1` / source / `^` / blank / stack / blank / `Node.js v24.16.0` | P: stack only |
| `fail.mjs` same | `file://<root>/fail.mjs:1` / source / caret col 6 / … | P: stack only |
| `-e "require('missing-pkg')"` | `node:internal/modules/cjs/loader:1503` / `  throw err;` / `  ^` / … stack … ` {` `code: 'MODULE_NOT_FOUND'`, `requireStack: [ '<root>/[eval]' ]` `}` / trailer | P: stack through `at [eval]:1:1`, no props |
| `throw 42` (file entry; `node throw.cjs 2>&1 \| od -c` starts `\n/…`) | blank / header / `42` / ``(Use `node --trace-uncaught ...` to show where the exception was thrown)`` / trailer | P: `42` |
| `throw {a:1}` | header / `{ a: 1 }` / trailer | C: `#<Object>` (`formatThrown` → `noSideEffectsToString`; kernel child `String(value)` → `[object Object]`) |
| Error with `stack = undefined` | header / blank / `[Error: x]` / trailer | C: `Error: x` (kernel child `stack ?? message` → `x`) |
| `stack` getter that throws | header / `Error: x` / hint / trailer, status 1 | `node: <getter message>`, status 1 (no-COI) — the throw escapes `fatal()` (Final+GREEN reviewer probe at `4ce4a10ee`, scratch); the realm-trap path shares it |

`-e` already gets the `[eval]:N` header for a `throw` (`projectNodeEvalError`).
The kernel child's print has no carrier against Node; PR #406 compared it only
by a scratch COI probe (the 7 rows byte-identical to no-COI, modulo
`/home/project` paths and host frames).
Neighbours, not duplicates: `vm-display-errors-decoration` (a decorated stack;
Node's `IsExceptionDecorated` skips the header for it); the open PR #405 drafts
`node-eval-non-throw-diagnostic-header` (eval header for non-`throw` errors) and
`inspect-default-format-gaps` (inspect defaults the inspected form depends on);
`esm-import-miss-err-module-not-found`. Fault: `sibling-drift` (two fatal
formatters) and `provenance-lie` (stack printed as the whole report). Compat ⚠️
`process.md` "Fatal error stderr bytes".

## Question

Where does a file entry's header come from in the browser (assumption to
probe: Chromium exposes no V8 `Message` position to JS; `-e` reconstructs it
from the source), and does one
formatter own the report for both hosts (kernel `worker-entry.ts` print vs
`formatThrown`)? Settle at PICKUP against the rows above.
