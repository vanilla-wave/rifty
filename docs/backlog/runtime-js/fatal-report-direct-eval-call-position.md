---
area: runtime-js
status: draft
title: "A direct `eval` frame names its module without the call's `:line:col`"
created: 2026-11-23
why: A CommonJS module is itself eval-compiled in rifty, so V8 records a direct `eval`'s origin as the module's sourceURL without a position; Node prints `eval at <anonymous> (<file>:1:1)`
sources: [docs/public/compat/process.md, docs/adr/runtime-js/0450-project-vm-script-offsets-through-one-owned-stack-hook.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts, packages/runtime-js/src/module-loader/cjs-factory.ts]
---

## Context

Carrier row `throw-in-direct-eval` (`eval('function f() {\n  throw new
Error("ev");\n}\nf();')` in `main.js`; pins in
`tests/browser-unit/fixtures/node-file-pins.json`): rifty prints `at f (eval at
<anonymous> (<root>/main.js), <anonymous>:2:9)`, Node v24.16.0 `(eval at
<anonymous> (<root>/main.js:1:1), <anonymous>:2:9)`. The frame of the eval'd
code keeps its own position; only the call site's position is missing.
Accepted as outside the fatal report's frame contract by the manager's reading
(ADR-0571, 2026-11-23), not the user's words. Same on `err.stack` (compat
modules.md "CJS stack positions").

Owner: runtime-js (CJS factory / fatal report); trigger: a CJS compile path
that records eval origins with positions, or a report that the missing call
position misleads.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
