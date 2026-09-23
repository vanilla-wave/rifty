---
area: runtime-js
status: draft
title: A ref'd `MessagePort` keeps the Node program alive, as in Node
created: 2026-09-23
why: emnapi holds the Node loop for pending napi async work with `new MessageChannel().port1.ref()`; rifty's MessagePort is the browser one with no `ref`/`unref`/`hasRef`, so the call is skipped and a program whose only pending work is rolldown async napi work (vite 8 config bundle, `parseAstAsync`) drains and exits 0 — the observed silent `vitest run`
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/keepalive-residual-gaps.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

Prior draft attempts at this goal (PRs #351, #352; evidence only, not
authority) both found the same wall after items 1–11: `vitest run` still
exits 0 with no output while vite 8.0.16 bundles `vitest.config.ts` through
the rolldown wasm32-wasi binding. `@emnapi/runtime` 1.10.0
`NodejsWaitingRequestCounter` creates `new MessageChannel().port1` and calls
`ref()`/`unref()` only when they exist; rolldown unrefs its own pool Workers
on purpose, so in Node the ref'd port is the one holder. Node v24.16.0 (their
oracle runs): `port1.ref()` alone holds the process, a fresh port has
`hasRef() === false`, a port with a `'message'` listener holds, `unref()`
releases. Carrier is a handle class in event-loop-keepalive (ADR-0152
correction or a short ADR citing it) — never an emnapi/rolldown patch. The
instrumented vitest-main run at pickup confirms this is the drained wait
(map open question). Traces to I4 (`vitest run` never exits 0 with empty
output), not a widened I2.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P3 root cause = narrow keepalive handle set)
