---
area: runtime-js
status: draft
title: "The fatal report carries Node's `<file>:<line>` header (throw, rejection, compile error)"
created: 2026-11-22
why: Node heads every fatal report with V8's message location; rifty prints none on any path (ADR-0445 2026-11-22, manager decision after PR #421 review round 2), so an agent reads file:line only from the first frame; a compile error names only its file (main's `ModuleLoadError`)
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md, docs/backlog/epics/node-file-entry-parity/goal.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

2026-11-23 — user (goal `node-file-entry-parity` amend, asked by the manager: «Отчёт об ошибке без заголовка Node; у синтаксической ошибки — только имя файла: „ок“ или отдельная задача»): «давай положим в бэклог на всякий». Deferred, not dropped: owner — runtime-js (fatal report / module loader); trigger — a user request, or a source that gives a place and message without inference (an engine-level message location, or for a syntax error rifty's own parser giving message and position together).

V8's message location is not readable from JS. Each inference shipped in PR
#421 printed false headers (ADR-0445 2026-11-22 lines):
- synchronous throw — the propagating `throw` statement; creation ≠ throw
  (kept, rethrown, swallowed, runtime-caught errors), three rule sets failed.
- unhandled rejection — `Exception::CreateMessage(error)`: the error's top
  frame, unless its `stack` was already serialized (then Node names
  `node:internal/process/promises`, deleted by the oracle projection: no
  header). False headers seen: `catch (e) { console.error(e); throw e }` and
  `String(e.stack)` before `Promise.reject(e)`; source read from the VFS at
  report time after the file was rewritten; a BOM-led line (caret one column
  short); a message containing frame-like text (`new Error('a\n    at f (…)')`,
  caret at 0, Node 15).
- compile error — V8's parse position vs acorn's stop token (`foo((a) });`
  Node `missing ) after argument list` caret 7; `const a}` caret 7; `class X
  { … }` Node prints no caret; a source's own `//# sourceURL=x.js` → Node `x.js:2`).

Only an engine-level source can carry it: Chromium's `ErrorEvent.lineno/colno`
for a realm-uncaught error, an isolated-vm hook exposing the V8 message, a
compile API reporting the parse position. Review leads for a rejection, if
attempted: a "stack already serialized" mark from rifty's own stack hook, a
snapshot of each module's source at compile time (not the VFS at report
time), Node's BOM column handling. Acceptance: one-sided generator against
live Node (a printed header equals Node's; programs that read `.stack`,
rewrite their file, carry a BOM or frame-like messages), and the corpus
`NODE_HEADER` assertion replaced by per-row equality.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
