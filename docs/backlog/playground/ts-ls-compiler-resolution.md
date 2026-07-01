---
area: playground
status: ready
title: ts-LS resolves workspace TypeScript via package exports
created: 2026-07-02
why: the language service locates the compiler at a hardcoded `<pkg>/lib/typescript.js` probe — a layout-divergent typescript build fails "TypeScript is not installed" even though Node's `require('typescript')` would resolve it
user_story: As a developer using a patched/relocated typescript build in my project, I want the editor LS to load it the way Node would, but today only the stock `lib/` layout is found.
epic: preset-deglue
blocked_by: []
sources: []
code: [packages/ts-language-service/src/lib-dts.ts]
---

## Context

`lib-dts.ts` walks up node_modules probing `${candidate}/lib/typescript.js` and builds `${workspaceRoot}/lib/typescript.js` directly — the stock npm layout, not Node resolution. The API-surface duck-check (`version`/`createLanguageService`/`parseJsonConfigFileContent`/`getDefaultLibFileName`) is correct and stays: it is the honest compat line for non-tsserver-compatible compilers.

## Acceptance

- Workspace compiler resolved with Node resolution semantics against the project's node_modules (the `typescript` package's `exports`/`main`), not a hardcoded `lib/typescript.js` probe; nested + hoisted layouts covered by unit tests.
- API-surface validation unchanged and loud: non-conforming module → `did not export a compiler API`.
- Regression tests: (1) typescript package with relocated entry (`main` → `dist/typescript.js`) loads; (2) package absent → same loud "TypeScript is not installed"; (3) stock layout still resolves to the identical file as before.

## Parity cases

- Resolved compiler entry ≡ Node `require.resolve('typescript')` from the workspace root, for stock and relocated layouts (parity-runner comparison).

## Out of scope

- Compilers lacking the required API surface (no `createLanguageService` etc.) — still a loud error, no adapter layer.
- Resolving typescript from anywhere other than the project's node_modules chain (no global/bundled fallback).

## Decisions

- Resolution reuses rifty's existing module-resolution code (no new resolver in ts-language-service). REVERSIBLE.
- The duck-typed API-surface check remains the compat contract — resolution honesty must not soften validation honesty.
