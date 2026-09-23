---
area: runtime-js
status: ready
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/❌ rows — source greps and shimmed probes do not close acceptance
epic: vitest-run-in-browser
blocked_by: [npm-client/overrides-bare-version-spec, runtime-js/path-posix-win32-builtins, runtime-js/builtin-static-names-prototype-methods, runtime-js/absent-builtin-members-loud-throws, runtime-js/symbol-key-global-write-guard-precision, runtime-js/readable-pipe-never-ends-process-stdio, runtime-js/process-lifecycle-events-exit-code, runtime-js/worker-threads-handle-keepalive, runtime-js/child-process-advanced-ipc-serialization, runtime-js/vm-run-in-this-context-offsets, runtime-js/worker-threads-stdio-streams-empty-exec-argv]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md, docs/public/compat/package-tooling.md, docs/public/compat/vite-command.md]
code: [tests/e2e/vitest-install-override.spec.ts, docs/public/compat/vitest.md, docs/public/compat/README.md]
---

## User scenario

In a fresh Chromium browser shell, install the goal's exact manifest, write
`vitest.config.ts`, `src/sum.ts`, `src/sum.test.ts` and an excluded root
`outside.test.ts`, then run Vitest through the real shell. The assertion fails
with Node's reporter and exit 1, then passes after editing the test; default
forks, threads, `npm test` and verbose agree. → scenario

## Reference contract

Real Node v24.16.0/npm 11.17.0 with exact Vitest 4.1.11/Vite 8.0.16 and the
same TypeScript project: commands and observable output in
`reference/vitest-run-acceptance-evidence.md`. Chromium RED on root PR
06153584b reaches a named @vitest/utils loader ceiling but exits 0; the
first assertion fails before the config and tests load. The e2e uses terminal
history for exit status, not printed status text. Timing/ANSI are unclaimed.

## Acceptance

1. Clean `npm install` exits 0, puts one Vite 8.0.16 beside Vitest 4.1.11 and the rolldown wasm32 binding; no nested Vite. → I1
2. Default `vitest run` loads `vitest.config.ts`, transforms typed source/tests, excludes root `outside.test.ts`, reports one file, one pass/one failure with `expected 3 to be 4` and `-4/+3` diff, exits 1. → I4
3. Editing only `src/sum.test.ts` makes the same `vitest run` report one file/two passes and exit 0. → I4
4. `npm test` and `vitest run --reporter=verbose` have matching fail/pass counts and exit status; verbose names both tests. → I4
5. `vitest run --pool=threads` has the same failing and fixed results/status as default forks. → I5
6. The claimed CLI/worker path reaches reporter results without a link-time error, loader ceiling or silent exit. → I6
7. `docs/public/compat/vitest.md` and its index entry state the exact pair and override/lock precondition, ✅ I1–I6 only after this e2e is green, and ❌ out-of-scope paths with their loud ceilings. → I7

## Parity cases

1. Real Node and Chromium execute the same manifest, config, typed source/test, and excluded root test. Node's failing default/threads/verbose runs report `1 failed | 1 passed`, diff and exit 1; the Chromium e2e must match these observables. → I4, I5
2. After editing the assertion, both runtimes report `2 passed` with exit 0; `npm test` follows the same script. → I4, I5
3. The existing install e2e checks exact versions and one Vite tree before the command runs. → I1

## Out of scope

- jsdom/happy-dom, watch, coverage, browser mode, `vmThreads`/`vmForks`,
  other Vite versions, typecheck pool and `--changed` are unclaimed; the final
  compat ❌ rows name observed loud ceilings. No fallback or extra claim is
  inferred from an install-only pass.

## Decisions

- ready-verdict: 2026-09-23 — Contract+RED @ 74d8047da8e618815fd0155b535427b83d8224ce
- 2026-09-23 — acceptance reuses the already-green install e2e; stdout assertions follow Node counts/diff/file names and terminal history exit, never timing or ANSI.
- 2026-09-23 — compat skeleton records current RED truth; I7 ✅ rows and README index wait for end-to-end GREEN.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P5 exact pair)
