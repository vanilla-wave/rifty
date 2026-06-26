---
area: playground
status: active
title: vite8 — TS/JSX transform (oxc/WASI) has zero e2e/unit coverage
created: 2026-06-21
why: Vite 8 transpiles TS/JSX via real oxc (`transformWithOxc` → `rolldown/utils` over `@rolldown/binding-wasm32-wasi`, forced by NAPI_RS_FORCE_WASI=1) — the genuine path, SHOULD be faithful. But every preset + e2e ships only .js/.json/.css; no .ts/.tsx/JSX fixture exists. The headline "real Vite" capability (and the `npm create vite` default is .ts) is UNPROVEN against the project's parity-gold-standard rule.
user_story: As a dev who writes TypeScript/JSX in the sandbox, I want the .ts/.tsx → JS transpile-and-render path proven green on every push, but today nothing exercises it; a WASI-oxc load/transpile regression would surface only in my browser (raw TS → SyntaxError), uncaught by CI.
sources: [tests/e2e/m7-preview-sw.spec.ts, apps/playground/src/presets.ts, apps/playground/src/templates/vite.ts]
code: [apps/playground/src/templates/vite.ts]
---

## Context

`m7-preview-sw.spec.ts` drives the real Vite 8 serve and asserts a JS+JSON module
graph renders, but no fixture is `.ts`/`.tsx`/JSX, so the oxc/WASI transform path
(the real one) is never executed under test. JSX additionally needs oxc jsx
options wired (automatic runtime) — also unverified.

## Options or Next

Add a `.ts` (and ideally `.tsx`/JSX) source to a preset or a dedicated fixture;
extend the m7-style render guard to assert the TRANSPILED TypeScript renders
(`<h1>` from a `.ts` module) with no SyntaxError / transform throw. RED-prove the
WASI-oxc path. Acceptance: CI-active TS render guard, un-gated.

## Reversibility

REVERSIBLE — test/coverage only; no production code change.
