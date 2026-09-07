# Lazy compiler evidence

Baseline: d52ef8128; Node v24.16.0, esbuild 0.28.0, TypeScript 5.9.3.

- `rg -n autoDiscoverTsconfigPaths packages apps tools services tests --glob '!**/dist/**'`: production uses only loader/resolver implementation; consumers are 13 conformance calls and one unit call. No production host opts in.
- `pnpm exec vitest run --project integration tests/integration/client-compiler-loading.test.ts`: both complete-boot-graph assertions RED; actual TypeScript input in eager outputs. Test includes the toolchain's automatic dynamic runtime-worker bootstrap.
- Fault carrier bundles the real `runNodeEntry` and MemoryFsSync, removes the actual compiler output, executes JavaScript, then non-JavaScript eval in a fresh Node process. Baseline RED is eager compiler reachability, before removal; GREEN must also prove a named error and original chunk path on import failure.
- Existing reference semantics: unchanged `tools/node-parity-runner/cases/process/node-eval-context*.case.ts`, `packages/runtime-js/src/module-loader/node-eval.test.ts`, `packages/runtime-js/src/builtins/node-entry.test.ts`.
- DEC-2 independent decision review: unused discovery removed rather than async readiness at synchronous loader creation; explicit paths preserved (ADR-0380).

Packed tarball graph and before/after timing proof pending; source graph is a
fast regression carrier, not published acceptance.

## Executed RED

- Integration command above: 3 tests failed at eager TypeScript assertions; zero import/typecheck setup failures after harness path correction.
- `pnpm exec vitest run packages/runtime-js/src/module-loader/retired-tsconfig.test.ts`: 2 tests RED, both "expected [Function] to throw an error"; existing option is accepted at both loader and resolver.
