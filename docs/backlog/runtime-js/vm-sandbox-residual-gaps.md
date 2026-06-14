---
area: runtime-js
status: active
title: node:vm context rewrite — residual gaps after write-leak fixes
created: 2026-06-13
why: PR #26 closed the write-leak class (var initializers, compound/update ops, destructuring, for-in/of targets, delete, switch scope) but four documented gaps remain in the AST-rewrite sandbox
user_story: As a developer running a config loader via `vm.runInNewContext`, I want `f(); function f(){}` hoisting and `var q = 5` completion values to match Node, but today the AST-rewrite sandbox throws ReferenceError on the hoist and yields `5` where Node yields `undefined`
sources: [M11, "PR #26 review", ADR-0123]
code:
  [
    packages/runtime-js/src/builtins/vm.ts,
    tests/conformance/builtins/vm.test.ts,
    tools/node-parity-runner/cases/vm/run-in-new-context.case.ts,
  ]
---

## Context

`node:vm` runs context code in the HOST realm via `with(proxy) + eval(rewritten)`;
writes are redirected to the context by an acorn AST rewrite. Verified remaining
gaps (each has a `TODO(backlog: runtime-js/vm-sandbox-residual-gaps)` marker or is
listed here for audit):

- **Direct `eval(...)`** in vm code evaluates UNREWRITTEN source — writes to
  undeclared names inside it leak to the host realm. Faithful interception is
  impossible without realm-level support (direct-eval scope semantics).
- **Top-level function declarations are not hoisted** — `f(); function f() {}`
  throws ReferenceError; Node runs it.
- **Completion values** of rewritten `var` statements: `var q = 5;` as the last
  statement yields `5`; Node yields `undefined` (empty completion).
- **`var` bindings vanish post-run**: a closure captured during the run reading a
  never-assigned hoisted var falls through to the host realm afterwards.
- **Perf**: parse+rewrite+`new Function` per execution, even for a reused
  `vm.Script` (cache rewrite per Script instance when it matters).

Read-side fall-through to host globals is BY DESIGN (compat property bags, not
security sandboxes — `docs/public/compat/modules.md`), not a gap.

## Options or Next

- Gate: a real consumer (e.g. a config loader or `node:test`-shaped runner) hits
  one of the gaps; fix that gap with a parity case first.
- eval: realistically permanent ❌ for this architecture; keep the compat note
  loud rather than half-intercepting.
- Function hoisting: move top-level `function f(){}` text into a prelude edit
  (`helper.f = function f(){...};` at program start) — needs edit-range care.

## Reversibility

REVERSIBLE — all gaps are documented divergences in an internal rewrite;
closing any of them is additive. eval interception, if ever attempted, gets its
own decision record.
