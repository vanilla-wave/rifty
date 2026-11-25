---
area: runtime-js
status: draft
title: A Promise crossing the QuickJS vm membrane throws QuickJSUseAfterFree instead of reaching the host
created: 2026-11-25
why: "any context Promise reaching the host (`runInNewContext('Promise.resolve(1)')`, an async function's result, a Promise property) throws `QuickJSUseAfterFree: Lifetime not alive` on the QuickJS engine where Node returns the Promise"
sources: ["PR #449 external review round 2 (manager-relayed, 2026-11-25)"]
code: [packages/runtime-js/src/builtins/vm/membrane.ts]
---

## Context

Probe 2026-11-25, live `node -e` v24.16.0 vs rifty parity-runner (in-process, QuickJS vm —
the generic-tier default; the no-COI toolchain defaults to `rewrite`, modules.md):
`typeof vm.runInNewContext(src)` → Node `"object"`, rifty `throw QuickJSUseAfterFree:
Lifetime not alive` for `Promise.resolve(1)`, `new Promise(() => {})`, `(async () => 1)()`,
`({ p: Promise.resolve(1) }).p`, `Promise.resolve(1).then((x) => x)` — every Promise
crossing the membrane, not one shape. Inside the context Promises work
(`typeof Promise.resolve(1)` → `"object"` both). Reviewer reports the same in a live
Workbench page (not re-measured here). Not probed: the `rewrite` engine. A loud throw, but an
internal one: neither Node's result nor a named `NotImplementedError`. Compat modules.md
row "`node:vm` value crossing as a Promise" ❌ added with this capture. Dedup: no
backlog/trap/declined match for `QuickJSUseAfterFree`/`Lifetime not alive`; neighbours
`runtime-js/vm-membrane-percent-s-branch`, `runtime-js/vm-quickjs-seed-readonly-and-brand`
(other membrane shapes), not duplicates.

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge). Final check of the written result (fresh reviewer, both drafts): 3 problems, resolved — compat ❌ row for the Promise gap; `runInContext` unreachable, `compileFunction`/`isContext` run; every membrane-crossing Promise throws, not one shape
