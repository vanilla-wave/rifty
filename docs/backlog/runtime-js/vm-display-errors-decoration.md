---
area: runtime-js
status: draft
title: Errors thrown out of host-realm `vm` scripts carry Node's default `displayErrors` decoration
created: 2026-09-24
why: Node prefixes such an error's `stack` with `file:line`, the source line and a caret (default `displayErrors: true`); rifty's `stack` starts at `Error: …`, so printed errors and stack parsers differ
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

REV-12 discovery of `runtime-js/vm-run-in-this-context-offsets`
(vitest-run-in-browser item 10; evidence §Discovered 2, unit Out of scope
"route to backlog at land", not filed then); pre-existing. An explicit
`displayErrors` option already throws
`NotImplementedError('<entry>.displayErrors')`; the default is silently
absent.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`):
`try { vm.runInThisContext('throw new Error("x")') } catch (e) {
String(e.stack).startsWith('evalmachine') }` and `e.stack.split('\n')[1]`:

```
node v24.16.0: true  | throw new Error("x")
rifty:         false | at eval (…)
```

Compat ❌ `docs/public/compat/modules.md` "Default `displayErrors`
decoration".

## Next

Owner runtime-js (vm). Trigger: a consumer printing or parsing a vm
error's `stack` head, or the next vm error-surface unit. Parity first:
decoration text for `runInThisContext`/`Script` with and without filename
and offsets, and Node's rule of decorating once (re-throw keeps it).
