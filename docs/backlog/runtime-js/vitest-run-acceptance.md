---
area: runtime-js
status: ready
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/⚠️/❌ rows — source greps and shimmed probes do not close acceptance
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/package-tooling.md]
code: [tests/e2e/vitest-run.spec.ts, playwright.config.ts, docs/public/compat/vitest.md, tools/compat-matrix-generator/cli.js, tools/compat-matrix-generator/readme.js, packages/runtime-js/src/builtins/vm/index.ts, packages/net/src/http/agent.ts]
---

## Context

Closes the goal: the scenario end to end in Chromium plus the public page.
Carrier = `tests/e2e/vitest-run.spec.ts` (heavy lane): real shell, real npm
registry, exit codes from terminal history, expected lines from the host
Node oracle (evidence §Oracle). Page = hand-maintained
`docs/public/compat/vitest.md`, registered in the generated compat index.
RED (r2, on `52e469720`) fails at goal I1 (`Failed to fetch packument
8.0.16: 404`); with the override respelled `vite@8.0.16` (scratch run) the
first `vitest run` prints `Startup Error / NotImplementedError: Not
implemented: module-loader.esm-global-function-assignment` (`@vitest/utils`
`timers.js`) and exits 0 — the rows below fail for the scenario's own walls
(evidence §RED r2).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P5 exact pair)

## Reference contract

- Oracle: Node v24.16.0 + npm 11.17.0 (Darwin arm64), vitest 4.1.11, vite
  8.0.16 via `overrides`, live registry; agent-detection env unset (std-env
  `isAgent` swaps vitest's default reporter — evidence §Host-harness artifact).
- Mechanism: the spec writes the oracle's exact files through the shell and
  runs the same commands; it asserts the reporter lines common to TTY and
  non-TTY Node runs, counts and exit codes — never timing/ANSI (I4).

## Acceptance

1. Clean project (`rm -rf node_modules package-lock.json`) seeded with the oracle files: npm-spelled `overrides: {"vite": "8.0.16"}` manifest, `vitest.config.ts` (`include: ['src/**/*.test.ts']`), multi-line `src/sum.ts` / `src/sum.test.ts` (failing assertion on line 9), `test/decoy.test.ts` that the default include would collect → scenario
2. `npm install` exits 0; output carries the `lightningcss-wasm@1.32.0 … substituted from shadow registry` line; the tree probe finds exactly one `vite` dir under `node_modules` (`node_modules/vite@8.0.16`), the lock's only vite entry is the same, vitest is 4.1.11 and `@rolldown/binding-wasm32-wasi` is installed → I1, scenario
3. Failing state, `vitest run` (default `forks` pool): exit 1; output has `RUN v4.1.11`, `❯ src/sum.test.ts (2 tests | 1 failed)`, `✓ first sum`, `× second sum`, `FAIL src/sum.test.ts > second sum`, `AssertionError: expected 3 to be 4 // Object.is equality`, the `- Expected` / `+ Received` / `- 4` / `+ 3` diff, location `src/sum.test.ts:9:21` with the line-9 code frame, `Test Files 1 failed (1)`, `Tests 1 failed | 1 passed (2)`; no `DECOY-COLLECTED` → I4, scenario
4. `npm test` and `vitest run --pool=forks` repeat row 3 (npm test also prints `> vitest run`); `vitest run --reporter=verbose` exits 1 with `✓ src/sum.test.ts > first sum`, `× src/sum.test.ts > second sum`, `→ expected 3 to be 4 …` and row 3's failure block and counts → I4, scenario
5. `vitest run --pool=threads` repeats row 3 and `--pool=threads --reporter=verbose` repeats row 4's verbose lines: same lines, counts and exit code 1 as `forks` → I5, scenario
6. Fixed state (line 9 `toBe(3)`): all six commands of rows 3–5 exit 0 with `Test Files 1 passed (1)`, `Tests 2 passed (2)`, and `✓ src/sum.test.ts (2 tests)` (default reporter) or both `✓ src/sum.test.ts > … sum` lines (verbose); no `FAIL`/`failed`, no decoy → I4, I5, scenario
7. No claimed run of rows 3–6 prints `Startup Error`, `ModuleLoadError`, `SyntaxError` or `Not implemented:` → I6
8. Unpinned manifest (`devDependencies: {vitest: "4.1.11"}` only): `npm install` exits 1 with `Not implemented: lightningcss.version` → I7
9. With `jsdom@30.0.1`, `happy-dom@20.0.0`, `@vitest/coverage-v8@4.1.11`, `@vitest/browser-playwright@4.1.11`, `playwright@1.60.0` installed over the pinned scenario (passing tests), each mode exits 1, never prints `Tests 2 passed`, and names its ceiling on the throw's own line: `--environment=jsdom` → `Not implemented: …DONT_CONTEXTIFY…`; `--environment=happy-dom` → `Not implemented: module-loader.esm-global-function-assignment`; `--coverage` → `Built-in 'node:inspector/promises' is not implemented`; `--pool=vmThreads` and `--pool=vmForks` → `Not implemented: …experimental-vm-modules…`; browser-mode config → `Not implemented: node:http(s).Agent` → I7
10. `docs/public/compat/vitest.md` claims exactly vitest 4.1.11 + vite 8.0.16, states the manifest precondition first (pin or npm-authored lock; unpinned = loud `lightningcss.version`), carries ✅ rows for I1–I6 including `vitest.config.ts` and TypeScript test files and both pools, ❌ rows only for jsdom/happy-dom, coverage, browser mode, `vmThreads`/`vmForks` each naming the row-9 throw, ⚠️ unclaimed rows stating the observed boundary with no mode/version ban — watch mode (non-TTY shell stdin: bare `vitest` runs once, row 11; `--watch` untested, no named ceiling) and other Vite/vitest versions (releases requiring `lightningcss ^1.33.0` fail install loudly, row 8; 7.3.6/8.0.x/8.1.x untested) — cites `tests/e2e/vitest-run.spec.ts`, and is listed in `docs/public/compat/README.md` → I7
11. Fixed state, bare `vitest` (no `run`; shell stdin is not a TTY): runs once and exits 0 with row 6's default-reporter lines and no row-7 wall, as Node `vitest < /dev/null` (parity 7) → I7

## Parity cases

Carrier: the e2e rows above against the host transcript (evidence §Oracle;
command + output + version); vitest is out of `tools/node-parity-runner`
reach (needs npm install + pools).

1. Failing file on Node: `❯ src/sum.test.ts (2 tests | 1 failed)`, `✓ first sum`, `× second sum`, failure block with diff and `src/sum.test.ts:9:21`, `Tests 1 failed | 1 passed (2)`, exit 1 — identical line set for `--pool=threads`, and for TTY stdout apart from the erased summary window → I4, I5
2. Fixed file on Node: `✓ src/sum.test.ts (2 tests)`, `Tests 2 passed (2)`, exit 0 on forks and threads (the file line is printed; its omission is an agent-env artifact) → I4, I5
3. `--reporter=verbose` on Node: `✓|× src/sum.test.ts > <name>` per test, `→ <message>` under a failure; same counts/exit → I4
4. `npm test` on Node = `vitest run` + npm banner (`> test`, `> vitest run`); same lines/exit → I4
5. `test/decoy.test.ts` is collected by default (config moved away: `Tests 1 failed | 2 passed (3)`) and not with the config → I4
6. `npm install` with the npm-spelled override: one hoisted `node_modules/vite@8.0.16`, `vite@8.0.16 deduped` under `@vitest/mocker`, no `node_modules/vitest/node_modules/vite` → I1
7. `vitest` without `run`, stdin not a TTY (`< /dev/null`) on Node: `RUN v4.1.11`, `✓ src/sum.test.ts (2 tests)`, `Tests 2 passed (2)`, exit 0 — one run; a TTY stdin or `--watch` stays in `Waiting for file changes...` (evidence §Oracle — outside the claim) → I7

## Out of scope

- `vitest --watch`, watch under a TTY stdin, Vite 7.3.6/8.0.x/8.1.x and
  vitest other than 4.1.11: unclaimed ⚠️, untested, no mode/version ban
  (goal amend 2026-09-23).
- `typecheck` pool, `--changed`, `--logHeapUsage`, `--ui`,
  workspaces/projects: unclaimed, untested (page Known Limitations).
- npm's `> test` script banner line (rifty's npm prints only
  `> <command>`); byte-identical timing/ANSI; the TTY summary window.
- Re-pinning over an installed `node_modules/vite`
  (`npm-client/stale-package-dir-on-version-change`); the scenario starts
  clean.
- Browser-mode execution itself (launching a browser from the browser).

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 2c490a807d0729e00d7962ba0fb5e21681b2da55
- 2026-09-23 — agent: page = hand-maintained `vitest.md` (package-tooling.md shape); the README index is generator-owned (`renderReadme` in `tools/compat-matrix-generator/cli.js`, pinned at 1269 lines, zero headroom) → IMPLEMENT moves `renderReadme` into a new `tools/compat-matrix-generator/readme.js` and adds the vitest line there; `check:compat-drift` diffs generator output only.
- 2026-09-23 — agent: loud throws row 9 needs that no child owns ride this unit (`REV-12`): jsdom `vm.constants`/`DONT_CONTEXTIFY`, browser-mode `http.Agent`; carrier chosen at IMPLEMENT, any parity claim it adds (e.g. real `vm.constants` symbols) carries its own parity case.
- 2026-09-23 — agent: assertions = lines common to TTY and non-TTY Node output (rifty children: stdout TTY, stdin not); draft PR #351's "passing file line omitted" was an agent-env artifact (evidence).
- 2026-09-23 — agent: `vitest.md` ✅ rows are pending until this spec is GREEN; Test Sources gains the I2/I3/I6 parity cases the children land.
- 2026-09-23 — reception (`REV-12`) of Contract+RED r1: blocker HOLDS — goal scenario 5 + I7 ("❌ rows for … watch mode … other vite versions — each ❌ backed by a loud throw") have no clause and no honest route (evidence §Static reads, §Reception r1); the earlier "asked at CLOSE" contradicted `STOP-1` (1e halts the run) → demoted to draft (`RDY-6` §4), STOP-1e asked now. Options: A amend I7/scenario 5 — exact pair guaranteed, watch/other versions ⚠️ unclaimed with the observed boundary, no bans (recommended; page drafted so); B keep I7 via mode/version bans (the goal's rejected source-shape route; a ban on a working version is a fake gap); C TTY stdin for shell children (terminal work + ADR, `terminal/raw-stdin-deferred-items`) so watch hits the loud `process.stdin.setRawMode` — versions still need A or B. Silence: run halted, goal PR draft.
- 2026-09-23 — STOP-1e answered: goal amend 2026-09-23, user: "A: поправить I7 (Recommended)" — scenario 5 + I7: watch mode and other vite versions ⚠️ unclaimed with the observed boundary, no mode/version bans; ❌ + loud throw stays for jsdom/happy-dom, coverage, browser mode, `vmThreads`/`vmForks` → Context question removed, status ready.
- re-cut: 2026-09-23 — row 10 names the ⚠️ watch/other-versions rows with their observed boundary (was "per the STOP-1e answer"); row 11 + parity 7 add bare `vitest` = one run under non-TTY shell stdin, the boundary the watch row states; Out of scope lists the unclaimed rest — trace: none
- 2026-09-25 — IMPLEMENT on the goal tree `d1a44f616`: RED r3 = scenario green as landed, first wall the jsdom bare `TypeError` (evidence §IMPLEMENT). Row-9 carriers per ADR-0464 (adds admission to ADR-0443 §2): `vm.constants` real (parity `vm/constants`) + `createContext(DONT_CONTEXTIFY)` → `vm.createContext.DONT_CONTEXTIFY`; `http.Agent` loud ctor `node:http.Agent` (parity `http/agent-shape`; the `node:http` module object moved to `http/index.ts` for `server.ts` pin headroom). Ceiling texts match the named errors (no re-cut); browser mode names `node:https.Agent` (first construction).
- 2026-09-25 — README index line via `tools/compat-matrix-generator/readme.js` (`renderReadme` moved out of `cli.js`); `http.md` `http.Agent` ❌ row; `vitest.md` ✅ rows final at GREEN, Test Sources list the children's carriers; watch ⚠️ row narrowed to the tested passing-project run (row 11); versions ⚠️ row names 8.3.1 (registry drift, evidence §GREEN).
- 2026-09-25 — observation (`REV-12`, deferred): after a vm-pool start ceiling rifty prints vitest's `close timed out after 10000ms` teardown lines Node does not (evidence §Observation); unclaimed error path, root cause undiagnosed → driver routes via `rifty-to-backlog` (runtime-js keepalive); page vm-pools row states it.
