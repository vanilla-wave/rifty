# Lazy compiler evidence

Baseline: d52ef8128; Node v24.16.0, esbuild 0.28.0, TypeScript 5.9.3.

- `rg -n autoDiscoverTsconfigPaths packages apps tools services tests --glob '!**/dist/**'`: production uses only loader/resolver implementation; consumers are 13 conformance calls and one unit call. No production host opts in.
- `pnpm exec vitest run --project integration tests/integration/client-compiler-loading.test.ts`: both complete-boot-graph assertions RED; actual TypeScript input in eager outputs. Test includes the toolchain's automatic dynamic runtime-worker bootstrap.
- Fault carrier bundles the real `runNodeEntry` and MemoryFsSync, removes the actual compiler output, executes JavaScript, then non-JavaScript eval in a fresh Node process. Baseline RED is eager compiler reachability, before removal; GREEN must also prove a named error and original chunk path on import failure.
- Existing reference semantics: unchanged `tools/node-parity-runner/cases/process/node-eval-context*.case.ts`, `packages/runtime-js/src/module-loader/node-eval.test.ts`, `packages/runtime-js/src/builtins/node-entry.test.ts`.
- DEC-2 independent decision review: unused discovery removed rather than async readiness at synchronous loader creation; explicit paths preserved (ADR-0380).

Published acceptance: `node tests/integration/workbench-packed-consumer.mjs --surface-only --keep` passed with 15 first-party + 72 external tarballs, strict TypeScript, real Chromium boot/eval/compiler request and blocked-request fault. The probe installs the real runtime in a Worker, not page-side fake process globals.

## Executed RED

- Integration command above: 3 tests failed at eager TypeScript assertions; zero import/typecheck setup failures after harness path correction.
- `pnpm exec vitest run packages/runtime-js/src/module-loader/retired-tsconfig.test.ts`: 2 tests RED, both "expected [Function] to throw an error"; existing option is accepted at both loader and resolver.

## Browser finding and repair

- Initial lazy import in packed Chromium 148.0.7778.96 failed: `TypeScript compiler chunk failed to load`, cause `TypeError: c.platform is not a function`. TypeScript 5.9.3 selected Node-host initialization after the runtime installed process/require; browser-mapped os is empty.
- ADR-0381 records the independent carrier decision. Generator wraps unchanged pinned TypeScript in lexical browser bindings; zero guest-global mutation or additional Worker. Differential `tools/checks/eval-compiler.test.ts` compares upstream transpile/diagnostics and checks host process identity + zero host require calls.
- `tests/integration/client-compiler-loading.test.ts`: all 3 GREEN, including actual missing emitted chunk; subprocess explicitly exits after observations (real runtime leaves handles open), with a 10s harness bound. Semantic assertions unchanged.
- Packed browser proof now passes both a real successful TypeScript-only classification and a blocked compiler request after successful JavaScript eval; explicit CommonJS const marker preserved.
- Bootstrap graph accounting includes Chromium-observed dynamic QuickJS JS imports. Early static-only numbers undercounted 15,822 min bytes / 5,424 gzip bytes per worker.

## Measurements

`docs/backlog/runtime-js/reference/lazy-compiler-packed-results.json` contains
all values. Splitting/minified packed eager JS, including readiness-joined
imports: generic 4,311,637 → 725,335 B (gzip 1,245,917 → 213,462);
toolchain 4,568,192 → 981,370 B (gzip 1,326,387 → 293,820).

Cold Chromium contexts, local HTTP/no-store, three samples (raw timings in JSON).
Initial compiler-only iteration medians: generic 132.8 → 22.6ms, toolchain
132.7 → 33.9ms; final preload-preserving samples replace the JSON after row.
Local observations, no latency gate;
no network shaping, and baseline overlapped a package build. Bytes are exact;
timings are not a controlled performance guarantee.

Reproduce: measure fixture with `measureClientBundles`, then
`observePackedWorkerBoot` + `accountPackedBootRequests`; final packed harness
runs these and the fault proof automatically. Baseline uses frozen original
packed tarballs from d52ef8128 with the same measurement helpers.

## Caller-sweep correction

Full `pnpm pr:check` found examples/vite-like-dev (omitted from the original directory list): typecheck TS2353 and 7/10 integration assertions fail with obsolete-option errors, 0 timeouts. Gate reran that file once in isolation: same seven failures. 9713 other tests and full parity passed. Independent decision review confirms preserve baseline via preload (ADR-0382); removal decision superseded.

- Preload delta Contract+RED initially BLOCKed for missing failed-preload carrier and removed discovery assertions. Restored baseline conformance files before implementation; added a real missing-compiler-output preload fault test. Current source still lacks preload; focused run re-executes these REDs for independent verification.

- Preload delta GREEN: 267 focused tests (244 unchanged resolver, 10 unchanged example, 6 file-URL, 3 preload, 4 real-bundle/fault). Strict packed fixture build/typecheck plus Chromium eval/preload success and blocked shared-compiler requests pass; default and explicit loaders remain usable after failed preload.
- Packed compiler attribution follows actual producer source maps to the generated upstream file, so shared chunks cannot hide compiler bytes behind renamed wrappers. Chromium's native dependency-fetch error names the initiating dynamic entry; the fault assertion binds that URL to its emitted entry while the request ledger names the aborted shared compiler output.
- The browser harness does not run two CLI eval lifecycles in one process; post-preload-failure usability uses the synchronous default/explicit loaders. Existing CLI one-lifecycle baseline is preserved.
