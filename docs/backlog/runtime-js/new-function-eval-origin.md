---
area: runtime-js
status: draft
title: "A `new Function` frame's `eval at` origin names the caller's file and position"
created: 2026-11-23
why: rifty routes the `Function` constructor through a helper (so `import()` works in the body), and V8 records that helper as the code's origin; Node prints `eval at <anonymous> (<file>:1:1)`
sources: [docs/adr/runtime-js/0571-prove-node-file-entry-and-fatal-report-parity-against-live-node-node-s-report-in-the-isolate-guest-only.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/module-loader/function-import-routing.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Carrier row `throw-in-new-function` (`new Function('throw new Error("fn")')();`
in `main.js`; pins in `tests/browser-unit/fixtures/node-file-pins.json`),
Node v24.16.0 `at eval (eval at <anonymous> (<root>/main.js:1:1),
<anonymous>:3:7)`. rifty: the browser hosts print `eval at <anonymous>
(<runtime>/packages/runtime-js/src/module-loader/function-import-routing.ts)`,
the isolate `eval at <anonymous>, <anonymous>:3:7` (its report drops the
runtime path). The eval'd frame's own `:3:7` and the caller frame
(`Object.<anonymous> (<root>/main.js:1:38)`, fixed in PR #425) are Node's.

Cause: rifty, not V8. The CJS rewrite replaces the `Function` identifier with
a same-length helper (`cjs.ts`), which rewrites `import()` in the body and
calls the real constructor; V8 takes the origin from the constructor's JS
caller, i.e. the helper. No JS API sets it. Accepted as outside the fatal
report's frame contract by the manager's reading (ADR-0571, 2026-11-23), not
the user's words. Fault class: `sibling-drift` between the routed and the
native constructor.

Owner: runtime-js (module loader, Function routing). Trigger: a debugger or
agent report misled by the origin, or the next change to Function routing.

## Question

How can the origin name the caller's file and position without dropping
`import()` inside a `new Function` body?

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
