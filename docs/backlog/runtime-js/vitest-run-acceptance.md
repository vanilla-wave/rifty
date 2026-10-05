---
area: runtime-js
status: ready
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/❌ rows — source greps and shimmed probes do not close acceptance
user_story: As a developer opening a JS project in the browser IDE, I want npm install + npm test (vitest) to behave like on my machine, and the compat page to tell me exactly what works and what stays loud
epic: vitest-run-in-browser
blocked_by: [npm-client/overrides-bare-version-spec, runtime-js/path-posix-win32-builtins, runtime-js/builtin-static-names-prototype-methods, runtime-js/absent-builtin-members-loud-throws, runtime-js/symbol-key-global-write-guard-precision, runtime-js/readable-pipe-never-ends-process-stdio, runtime-js/process-lifecycle-events-exit-code, runtime-js/worker-threads-handle-keepalive, runtime-js/child-process-advanced-ipc-serialization, runtime-js/vm-run-in-this-context-offsets, runtime-js/worker-threads-stdio-streams-empty-exec-argv]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/package-tooling.md, docs/public/compat/vite-command.md]
code: [tests/e2e/vitest-run.spec.ts, docs/public/compat/vitest.md]
---

## User scenario

Goal scenario (goal.md §User scenario): clean project with the npm-spelled
manifest, `vitest.config.ts`, TypeScript source + test (1 passing, 1 failing
assertion); `npm install` → one vite 8.0.16, exit 0; `vitest run` → config
glob honoured, default reporter, `1 passed`/`1 failed` with the diff, exit 1;
fix → exit 0; `npm test` and `--reporter=verbose` same; `--pool=threads` same
results and exit code as forks; unclaimed options (jsdom) loud.

## Context

Carrier pattern: `owner-shell-prettier-eslint.spec.ts` (real package CLI
through the shell, exit codes via terminal history). The vitest spec mirrors
it: heavy lane (`HEAVY_SPECS`), Chromium-only, 600 s budget. The compat page
follows `vite-command.md`'s shape: manifest precondition first, then ✅ rows
for I1–I6 (incl. `vitest.config.ts` and `.ts` tests) and ❌ rows for
jsdom/happy-dom, watch, coverage, browser mode, vm pools, other versions —
each backed by a loud throw, never a silent fallback. Assertions target
pass/fail lines, counts and exit codes — not timing/ANSI (goal I4).

Map fog carried here (goal map §Open questions): `vitest.config.ts` loading
(vite `loadConfigFromFile` → rolldown config bundle) and vitest's `.ts`
transform under its module runner are FIRST exercised by this spec — a wall
found there re-charts the map with a new child, never a silent narrowing.

## Acceptance

1. `tests/e2e/vitest-run.spec.ts` (heavy lane) runs the goal scenario:
   install asserts `npm: + vitest@4.1.11` and `npm: + vite@8.0.16`, exit 0
   (`→ I1`, scenario step 2).
2. `vitest run` asserts the config's include glob (an un-included sibling is
   NOT collected), `1 passed`/`1 failed`, the assertion diff surface, exit 1;
   after the fix exit 0; `npm test` and `--reporter=verbose` same (`→ I4`,
   scenario step 3).
3. `vitest run --pool=threads` asserts the same results and exit code as the
   forks default (`→ I5`, scenario step 4).
4. An unclaimed option (`--environment=jsdom`) asserts a loud
   `NotImplementedError`-shaped output and a non-zero exit — never a silent
   pass (`→ I6/I7`, scenario step 5).
5. `docs/public/compat/vitest.md` exists with the manifest precondition, ✅
   rows for I1–I6 (incl. `vitest.config.ts` + `.ts` tests), ❌ rows for
   jsdom/happy-dom, watch, coverage, browser mode, `vmThreads`/`vmForks`,
   other vite/vitest versions — each ❌ naming its loud throw; registered in
   `docs/public/compat/README.md` (`→ I7`).

## Parity cases

n/a — this unit's carrier is the e2e spec plus the committed compat page; the
underlying capabilities carry their own parity cases (u1–u11).

## Out of scope

- jsdom/happy-dom (draft epic `jsdom-environment-in-browser`), watch, coverage,
  browser mode, vm pools, `--changed`, other versions — the ❌ rows + loud
  throws only.
- Honest npm (resolver/hoisting identity beyond the overrides spelling) —
  separate planned goal.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| unclaimed option | `vitest run --environment=jsdom` | loud `NotImplementedError` output, non-zero exit — asserted by the spec (`→ I7`) |
| wrong collection | a file outside the config `include` | not collected (asserted via the ignored sibling) (`→ I4`) |

## Challenge

challenge: 2026-10-05 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); carrier pattern (prettier-eslint e2e) verified against existing green specs

## Decisions

- 2026-10-05 — agent (PICKUP): spec added to `HEAVY_SPECS` (install ~50
  packages incl. wasm bindings + two pool runs — never parallel); exit codes
  via `terminalHistoryExitCode`; reporter assertions on lines/counts (goal I4
  exactness), not byte-identical output.
- 2026-10-05 — agent (PICKUP): the vitest-main keepalive fog (goal map) is
  observed HERE: if `vitest run` still exits early, the missing handle class
  re-charts as a new child (never a widened I2 without the user).
