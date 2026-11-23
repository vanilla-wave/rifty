---
area: runtime-js
status: draft
title: "A CommonJS file using top-level `new.target` loads as in Node whatever words it contains"
created: 2026-11-23
why: Node compiles CJS as a function body, where `new.target` is valid; rifty's rewrite passes parse it as a Script and throw ModuleLoadError once the text contains `import`, `Object`, `Function`, `global`, …
sources: [PR-421-external-review-round-3]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Found by the PR #421 external review (round 3), outside the scope of
ADR-0571. Reproduced by this capture (2026-11-23).

| `x.cjs` body | Node v24.16.0 (`node x.cjs` and `require('./x.cjs')`) | rifty isolate `require('./x.cjs')` |
|---|---|---|
| `console.log(new.target);` | `undefined`, exit 0 | `undefined` |
| `console.log(new.target); // import` | `undefined`, exit 0 | `ModuleLoadError` `SYNTAX_ERROR` `Failed to parse CJS source for /workspace/x.cjs: 'new.target' can only be used in functions and class static block (1:12)` |
| `console.log(new.target); import('fs').then(m=>console.log(typeof m.readFileSync));` | `undefined`, `function` | same ModuleLoadError |
| `console.log(new.target, typeof Object);` | `undefined function` | same ModuleLoadError |

rifty: `runCode` from `packages/isolate-host/dist` (built 2026-11-23 00:26,
after HEAD eccbe3a9d). A `.mjs` with top-level `new.target` is a SyntaxError
in Node (`new.target expression is not allowed here`): ESM is not affected.

Cause (read): two acorn passes over the CJS source, both `sourceType:
'script'` at top level — `rewriteDynamicImports` (gated by `/\bimport\b/`) and
`rewriteCjsFunctionConstructorReferences` (gated by
`functionRoutingAnalysisToken`: `Function`, `constructor`, `globalThis`,
`global`, `Object`, `Reflect`, `__defineGetter__`/`__defineSetter__`, `eval`,
`with`); acorn raises on `new.target` outside a function, Node's
`compileFunction` body accepts it. The gate makes the load depend on a word
in a comment. Whatever the parse catch consults first (at eccbe3a9d
`cjsSyntaxError`, a V8 function-body compile that accepts `new.target`), the
ModuleLoadError wrapper is what reaches the guest.
Dedup: no backlog/traps/ADR-declined match for `new.target`; neighbours, not
duplicates: `module-compile-error-node-syntax-error` (owns the
`ModuleLoadError SYNTAX_ERROR` wrapper for real syntax errors),
`function-constructor-exhaustive-metaprogramming-ceiling` (owns the
`functionRoutingAnalysisToken` gate). Fault: `sibling-drift` (analysis parse goal ≠ Node's compile
goal). No compat row.

## Acceptance

1. Parity case under `tools/node-parity-runner/cases/modules/`: each table row
   gives Node's stdout/exit; rows 2–4 RED on current main, row 1 a guard (green
   today). → scenario

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
