---
area: runtime-js
status: draft
title: node -e uncaught non-Error throw prints a String-like value, not Node's header + inspected value
created: 2026-11-18
why: Node prints the `[eval]` source header, caret, the value as `util.inspect` shows it and the `--trace-uncaught` hint; rifty's fatal text is `noSideEffectsToString(value)`, and from a timer or async function the value arrives wrapped as `Error: <value>` with a runtime frame.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Isolate host (ADR-0557) @ 937595c70 against `node -e` v24.16.0:
`throw 'oops'` → Node stderr `\n[eval]:1\nthrow 'oops'\n^\noops\n(Use \`node --trace-uncaught ...\` to show where the exception was thrown)\n\nNode.js v24.16.0\n`,
host `oops\n`; `throw Object.create(null)` → Node `[Object: null prototype] {}`
(after the header), host `[object Object]`; `throw function f() {}` → Node
`[Function: f]`, host `function f() {}`. `setTimeout(() => { throw 'oops' })`
→ host `Error: oops\n    at rifty-isolate-guest.js:…`: `awaitDrain` rejects
with `new Error(String(reason))` for a non-Error reason
(`event-loop-keepalive.ts`). Exit 1 in all, as Node. The host prints
`formatThrown`, rifty's own fatal text, so the browser `node -e` path shares
the first half; whether it shares the timer wrapping is unprobed there.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
