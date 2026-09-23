---
area: runtime-js
status: ready
title: ESM and CJS Function guards accept Symbol-valued global keys
created: 2026-09-15
why: the Function mutation guard rejects computed global writes whose key is an immutable Symbol, blocking @vitest/utils and undici before their code runs
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

`@vitest/utils` writes `globalThis[SAFE_TIMERS_SYMBOL]`, where a same-scope
`const` holds `Symbol.for(...)`. Undici calls `Object.defineProperty(globalThis,
globalDispatcher, ...)` with another such const. Both ESM/CJS guards treat an
unknown computed key as a possible string `Function`, even though these keys
are Symbols. String, mutable, shadowed, and unknown keys can still be
`'Function'` and must keep the existing ceiling.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## User scenario

During the goal's `vitest run`, its CLI and pool workers load `@vitest/utils`
and undici. A global property keyed by a same-scope `const` initialized with
unshadowed `Symbol(...)` or `Symbol.for(...)`, or by either call directly, is
written without the `module-loader.{esm,cjs}-global-function-assignment` error.
The write/descriptor is observable as in Node. A key that can be the string
`Function` still throws the existing named ceiling.

## Reference contract

Node v24.16.0 executes Symbol-key writes in both ESM and CJS; Symbol and string
property keys are distinct. Oracle commands and output live in
`docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md`.

## Acceptance

1. ESM and CJS loaded by the real rifty module loader execute Symbol-key global assignment and `Object.defineProperty` with a same-scope `const` or direct `Symbol(...)`/`Symbol.for(...)`; observable values match Node. → I6
2. A mutable key, a shadowed `Symbol`, or a shadowed key that may equal `'Function'` still throws the matching ESM/CJS `global-function-assignment` ceiling before mutation. → ADR-0171

## Parity cases

1. `modules/symbol-global-write-esm.case.ts` runs the ESM assignment/descriptor/Reflect forms in Node and rifty. → I6
2. `modules/symbol-global-write-cjs.case.ts` runs the CJS assignment/descriptor/Reflect forms in Node and rifty. → I6

## Out of scope

- Runtime-only or opaque aliases and dynamic keys: `runtime-js/function-constructor-exhaustive-metaprogramming-ceiling`; their current loud guard remains.
- `environment: 'jsdom'` completion: separate `jsdom-environment-in-browser` epic; undici loading here proves only this generic guard.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 3c5effd90836f7744b84566cc1f4632f51cfc60d
- 2026-09-23 — Reviewer concern: assert Function descriptor unchanged at throw; add during implementation.
- 2026-09-23 — Reuse each loader's lexical scope walker; accept only syntactically proven Symbol calls and immutable bindings.
