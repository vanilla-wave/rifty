---
area: toolchain-build
status: ready
title: Rewrite the nine toSorted sites and guard the shipped ES2022 floor — pr:check fails on unconditional ES2023+ builtins or syntax in shipped bundles
created: 2026-09-27
why: the declared bundle target is es2022, shipped workers use ES2023 `toSorted` unconditionally at nine sites (Chrome floor 110 instead of 108, Chrome 109 = last for Windows 7/8.1 ≈ 3.4 % RU traffic), nothing checks; the next accidental builtin moves the computed browser floor silently
epic: browser-support-floor
sources: [ADR-0469, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/internal/toolchain-input.ts, tools/publishing/build-workbench-assets.mjs]
---

## Context

Finding. 17 `tsup.config.ts` + `apps/playground/vite.config.ts` `build.target` + `tools/publishing/build-workbench-assets.mjs` say `es2022`; `tsconfig.base.json` lib is `ES2023`; shipped call sites use `Array.prototype.toSorted` (ES2023: Chrome 110 / Firefox 115 / Safari 16) — `no-coi-toolchain-worker.ts:101-102`, `host.ts:654`, `host-fs-recovery.ts:59-60`, `toolchain-input.ts:31,32,283,290`. esbuild downlevels syntax, never builtins; no check exists. Next candidates and their floors: `Object.groupBy` Chrome 117 / FF 119, `Promise.withResolvers` 119 / 121, `Array.fromAsync` 121 / 115, RegExp `v` flag 112 / 116.

Decision recorded in ADR-0469 (user 2026-09-27 "a"): floor = ES2022; the nine `toSorted` sites become `[...a].sort(cmp)` / `[...a].sort()` (same result, same comparator; the bundled TypeScript in the same graph already uses `slice().sort`), floors after: Chrome/Edge 108 (next binding: sync OPFS handle methods 108), Chrome Android 109 (OPFS family from 109), Opera 94, Firefox 114 (module workers; ESR 115 is the population, 114 ≈ 0.008 % RU). Scope = every shipped bundle: package `dist` and the playground build — `apps/playground/src/components/PreviewPanel.tsx:77` `.findLast(` (ES2023) is the tenth site. Already-shipped ES2024 behind feature detection: `Atomics.waitAsync` (`packages/kernel/src/ipc/capabilities.ts:26-29`, `worker-stdio-drain.ts:89-92`, `typeof` guarded) — the COI Firefox-145 binding requirement, allowlisted by name. Guard = a `check:*` lane over shipped `dist` bundles: syntax parse at `ecmaVersion: 2022` + real-call-site denylist for ES2023+ builtins (`toSorted`, `toReversed`, `toSpliced`, `with`, `findLast`, `findLastIndex`, `Object.groupBy`, `Promise.withResolvers`, `Array.fromAsync`, RegExp `v`) on an AST with a named allowlist for guarded uses, not a text grep — the research's dead-end shows text grep false-positives from bundled TypeScript lib-name tables (`es2024:["withResolvers"]`) and same-named own methods (`.with`, `.at`). → I2.

## Challenge

challenge: 2026-09-27 — clear; goal FIT resolved ES2022 ceiling, own-method false positives, named guarded waitAsync exception.

## Acceptance

1. `tools/checks/es-floor.test.ts` rejects real builtin calls (`toSorted`, `toReversed`, `toSpliced`, `with`, `findLast`, `findLastIndex`, `Object.groupBy`, `Promise.withResolvers`, `Array.fromAsync`) and ES2023+ syntax, names file/location, accepts lib-name tables and known own methods; named `Atomics.waitAsync` exception preserves capability guards/probes → I2.
2. `pnpm pr:check` builds package and playground bundles, checks every emitted JS recursively, rejects missing builds; no dist source-map or type-declaration false positives → I2.
3. Nine sorting sites and playground preview reconciliation preserve observable ordering and caller data under ES2022; existing runtime/preview tests and emitted bundle scan pass → I2.

## Out of scope

Polyfills; lowering below ES2022 (class fields / `#private` are shipped syntax); checking `node_modules` fixtures or test files; removing the guarded `waitAsync` use.

## Decisions

- 2026-09-28 — RDY-8 tooling preparation: initial guard test fails because guard absent; existing built bundles reproduce nine `toSorted` calls before rewrites; final independent review covers proof and behavior-preserving rewrites.

- 2026-09-27 — floor ES2022 with the `toSorted` rewrite — user "a", ADR-0469
