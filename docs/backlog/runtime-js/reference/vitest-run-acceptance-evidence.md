# Vitest run acceptance oracle and RED — 2026-09-23

## Node oracle

Host Node v24.16.0, npm 11.17.0. Fresh project:
`package.json` pins `vitest: 4.1.11` and `overrides.vite: 8.0.16`;
`vitest.config.ts` includes only `src/**/*.test.ts`; typed `src/sum.ts`;
`src/sum.test.ts` has one passing and one failing assertion; root
`outside.test.ts` throws `CONFIG-IGNORED` if collected.

```text
npm install
added 44 packages ... [exit 0]

./node_modules/.bin/vitest run
RUN v4.1.11
src/sum.test.ts (2 tests | 1 failed)
FAIL src/sum.test.ts > sum fails
AssertionError: expected 3 to be 4
- Expected / + Received / - 4 / + 3
Test Files 1 failed (1); Tests 1 failed | 1 passed (2) [exit 1]

./node_modules/.bin/vitest run --pool=threads
same file, counts and assertion diff [exit 1]

./node_modules/.bin/vitest run --reporter=verbose
src/sum.test.ts > sum passes; src/sum.test.ts > sum fails
same file, counts and assertion diff [exit 1]
```

`outside.test.ts` is absent in every run. After fixing the second assertion
to `toBe(3)`: default `vitest run`, `--pool=threads`, and `npm test` each report
`Test Files 1 passed (1); Tests 2 passed (2)` and exit 0. The verbose form
prints both passing names. Timing and ANSI differ between runs; assertions
target files, counts, diff, and process status.

## Chromium RED on root PR snapshot 06153584b

Dedicated port 5319; exact `tests/e2e/vitest-install-override.spec.ts` fixture
with the above manifest, config and TS files. Install, one vite 8.0.16,
vitest 4.1.11 and wasm32 binding verification pass. First `vitest run`:

```text
Startup Error
NotImplementedError: Not implemented: module-loader.esm-global-function-assignment
(ESM module /node_modules/@vitest/utils/dist/timers.js writes the Function
binding/global property ...)
terminal history exit: 0; expected Node: 1
```

The wall precedes config loading/file collection. It traces to goal I6 and
the wrong exit status to I3/I4. Later pool/reporter assertions remain unrun
until this first command reaches them.

## Chromium RED after root slices 5/6/9 — 8a0936c92

Same test and dedicated port 5319 after merging the newer goal branch into
the temp acceptance branch. Install and package/binding verification still
pass. The `@vitest/utils` loader ceiling is gone; first `vitest run` now
prints no reporter or Startup Error text and returns terminal history exit 0.
The e2e expects 1 and fails at that assertion. Config loading, collection,
both pool results, verbose and fixed reruns are still unobserved in rifty.

## Chromium RED on integrated goal branch 062056ba0

`pnpm build:libs` then `RIFTY_PLAYGROUND_PORT=5392 node_modules/.bin/playwright test --project=chromium-heavy --workers=1 tests/e2e/vitest-install-override.spec.ts` on committed 062056ba08bdfb74d34e0619e0475f4c8c026910: install/versions/wasm checks pass; first `vitest run` prints no reporter text and has history exit 0, so the test fails at its exit-1 assertion (1 test failed, 18.5 s). This tree includes Symbol guard, pipe, advanced IPC and VM offsets; lifecycle/Worker keepalive are still pending.
