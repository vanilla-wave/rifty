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
