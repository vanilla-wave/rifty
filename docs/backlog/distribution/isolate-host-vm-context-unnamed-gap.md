---
area: distribution
status: draft
title: The isolate guest's vm context calls throw rifty's internal "engine not preloaded" text, not a named gap
created: 2026-11-25
why: "`vm.createContext`/`runInNewContext`/`Script#runInNewContext` in `runCode` throw `Error: QuickJS vm engine not preloaded. Call await ensureVmEngineReady() …` — a message addressed to rifty's embedder, no `NotImplementedError('isolate-host.vm…')`, and compat isolate-host.md had no vm row"
sources: ["PR #449 external review round 2 (manager-relayed, 2026-11-25)", docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest, packages/runtime-js/src/builtins/vm/quickjs-loader.ts]
---

## Context

Probe 2026-11-25, isolate `runCode` (this branch, built packages), each call caught:
`vm.runInThisContext('1+1')` → `2`; `new vm.Script('2+2').runInThisContext()` → `4`;
`vm.runInNewContext('1')`, `vm.createContext({})`, `new vm.Script('3').runInNewContext()` →
`Error` (no `code`): `QuickJS vm engine not preloaded. Call await ensureVmEngineReady() at
boot (joined to the worker boot promise) before any synchronous vm.* sandbox call.` Node
v24.16.0: `1`, a context object, `3`. So `runInContext` is unreachable (no context;
`vm.runInContext('1', {})` throws the argument `TypeError`, `runtime-js/vm-context-arg-validation`);
`vm.compileFunction('return 5')()` → `5` and `isContext({})` → `false` run (final-check
reviewer's probe, `runCode` from built `dist`). The guest never preloads the QuickJS engine; whether
it should (cost, ADR-0557 isolate limits) or name the gap
(`NotImplementedError('isolate-host.vm.createContext')`, compat ❌) is undecided — open
question, not prescribed here. Compat isolate-host.md row "`node:vm`" ⚠️ added with this
capture. Dedup: no backlog/trap/declined match for the message.

## Question

Does the isolate guest run vm contexts (preload QuickJS in the guest, or another engine), or
declare them a named gap? Settle against ADR-0557 limits and a user scenario that reaches vm.

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge). Final check of the written result (fresh reviewer, both drafts): 3 problems, resolved — compat ❌ row for the Promise gap; `runInContext` unreachable, `compileFunction`/`isContext` run; every membrane-crossing Promise throws, not one shape
