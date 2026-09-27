# ES2022 guard — 2026-09-28

Authority: browser-support-floor I2, ADR-0469. RDY-8 tooling + behavior-preserving rewrites.

## RED

- `pnpm test:run tools/checks/es-floor.test.ts`: failed; `es-floor.mjs` absent.
- First executed AST scan of real existing dist: runtime-js seven `toSorted` calls, workbench worker two (also repeated in bundled assets). `/tmp/rifty-es-floor-baseline.log` held the run output.
- Added static alias/globalThis/destructuring checks: three fixture tests failed before implementation; same tests pass afterward.

## GREEN

- `pnpm build:libs`; `pnpm build:playground`: passed. First library attempt observed concurrent storage edit's missing `toolchain-terminal.reason`; storage fix landed, full build rerun passed.
- `pnpm check:es-floor`: `ES2022 floor: 329 shipped bundles checked`.
- `pnpm test:run tools/checks/es-floor.test.ts tools/checks/pr-check.test.ts`: 35 passed.
- `pnpm test:run tools/checks/es-floor.test.ts tools/checks/pr-check.test.ts apps/playground/src/components/PreviewPanel.test.ts packages/runtime-js/src/host.test.ts`: 85 passed: guard 28, lane wiring 7, PreviewPanel 18, host 32.
- Scoped Biome check and `pnpm backlog:check`: passed.

## Guard ownership

Acorn (existing dependency-cruiser parser) parses actual package/playground JS at ES2022. Missing/empty build roots fail. AST static builtin references include alias/destructuring/globalThis access; prototype call checks reject the named post-floor methods. Library string tables are data.

`Atomics.waitAsync`: named ADR-0469 exception; existing kernel guards and support probes own availability, including cross-function calls. No general feature-detection waiver.

Own methods remain distinct: TypeScript `ChangeTracker.with`, semver object updates, Monaco URI object updates and `getBracketPairsInRange(...).findLast` (CallbackIterable, monaco-editor 0.52.2 `esm/vs/base/common/arrays.js`). Ambiguous numeric `with` calls require exact Monaco 0.52.2 original file + call expression via its emitted sourcemap (Position, Dimension, InlayHintItem); unknown receiver, missing map, different source or changed expression fail. Trace mapping reuses Vitest's existing dependency. No polyfills/new dependencies.

## Copied compiler fingerprint

Full `pr:check` exposed the exact compiler-asset pin after rebuilding shared chunks (`traps.md` copied-asset-fingerprints). Baseline `3bef167de` rebuilt in memory using the publishing esbuild options and `git show` overlays for changed source files; no working source/dist mutation. Reconstructed worker exactly matches the old pin: 10,022,694 bytes, SHA256 `018ea49b3a1971609fdd02fb3f5b9db85daf0a4398fb500bbbf39bdda149b422`. Current worker: same size and 213,025 lines, SHA256 `2538b29ef2fc138bbb9cab5b4d4de8bbdec4dcf3fc95050fcc38e32dc933601d`.

Exactly seven lines differ: shared-chunk import names at lines 5, 8, 9, 21, 22, 24 and dynamic module-loader import at 211003. Compiler bytes otherwise identical. Lexical compiler `chunk-EMDIREKY.js` unchanged at 4,893,418 bytes, SHA256 `39be666ac003c7361e9fbcd88abdda1ed51052350ade9b57b4d2716f1e296498`. Updated only the TypeScript worker SHA pin; size ceiling and negative raw/gzip/base64 payload tests unchanged. Packed-browser proof remains in the driver's final gate.

Validation after the single pin change: `pnpm test:run tools/checks/esbuild-legacy-retirement.test.ts` 10/10 PASS, including unchanged raw/gzip/base64 rejection; `pnpm check:esbuild-legacy-retirement` PASS (10 paths, 25 references, exact emitted inventory).

## Integrated gate reception

First full `pnpm pr:check`: lint JSON formatting, exact compiler fingerprint and CI Node-oracle job-name test failed; test failure reproduced in one isolated rerun (0 Vitest timeouts). Formatting fixed; fingerprint proof above; restored existing workflow job ID `e2e`, unchanged `ci-change-scope.test.ts` passes 5/5. No correctness criterion weakened. Final complete gate rerun follows.

- `pnpm test:packed-toolchain-surface`: PASS on ef446585d product tree — 15 first-party +72 external tarballs, strict TypeScript + generic SDK/Worker graphs; includes real-browser compiler loading, VM/SDK/installed toolchain and agent scenarios. Output: `Packed toolchain surface passed`.
