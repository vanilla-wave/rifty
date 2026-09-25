---
area: runtime-js
status: ready
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/❌ rows — source greps and shimmed probes do not close acceptance
epic: vitest-run-in-browser
blocked_by: [npm-client/overrides-bare-version-spec, runtime-js/path-posix-win32-builtins, runtime-js/builtin-static-names-prototype-methods, runtime-js/absent-builtin-members-loud-throws, runtime-js/symbol-key-global-write-guard-precision, runtime-js/readable-pipe-never-ends-process-stdio, runtime-js/process-lifecycle-events-exit-code, runtime-js/worker-threads-handle-keepalive, runtime-js/child-process-advanced-ipc-serialization, runtime-js/vm-run-in-this-context-offsets, runtime-js/worker-threads-stdio-streams-empty-exec-argv, runtime-js/worker-threads-startup-options]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/package-tooling.md, docs/public/compat/vite-command.md]
code: [tests/e2e/owner-shell-vitest.spec.ts, tests/e2e/owner-shell-vitest-ceilings.spec.ts, docs/public/compat/vitest.md]
---

## Context

Carrier pattern exists: `owner-shell-prettier-eslint.spec.ts` (real package
CLI through the shell, exit codes via terminal history). The spec seeds the
goal's manifest with `vitest.config.ts` and `.ts` source/test files, asserts
one vite 8.0.16, that the config's `include` glob is honoured, the reporter's
pass/fail lines and counts, exit 1 → fix → exit 0, `npm test`,
`--reporter=verbose`, `--pool=threads` equality. Compat page: the manifest precondition first
(`overrides: {vite: "8.0.16"}` or an npm-authored lock; the organic
unpinned manifest stays a loud `lightningcss.version` install failure — goal
I7), then I1–I6 ✅ and measured jsdom/happy-dom, coverage, browser mode, vm
pool ceilings. Watch/other versions remain outside the guarantee without bans
(user amendment2026-09-25). Reporter output is
asserted on pass/fail lines and counts, not timing/ANSI (goal I4). The page is
registered in the compat README index. Exact assertions are compiled at
PICKUP; this lists what the goal's scenario needs.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P5 exact pair)

## Acceptance

1. Exact clean manifest installs one Vite8.0.16 with Vitest4.1.11 and existing wasm bindings. → I1
2. Original TypeScript config/include and tests produce failure1 with assertion diff, then success0 after correction; excluded sentinel stays uncollected. Default/forks/threads/verbose/npm test preserve counts and codes. → I4, I5, I6
3. Compat page guarantees only that scenario/pair, documents precondition and concrete measured ceilings; watch/other versions stay unclaimed without bans. Binary IPC is explicitly unsupported. → I7, scenario

## Parity cases

1. Same fixture native-oracle.mts runs all10 commands with expected fail/fix codes and counts. → I4, I5
2. owner-shell-vitest.spec.ts executes the same10 commands in fresh Chromium; installed-mode companion proves six measured negative paths. → I1, I4, I5, I6, I7

## Out of scope

Other package versions/modes, binary IPC and exact timing/ANSI output; no new
runtime mechanism or npm resolver work. Concrete unsupported calls remain loud.

## Decisions

ready-verdict: 2026-09-25 — existing accepted goal scenario and observed-baseline REDs; no new runtime promise. Whole-delivery review carries composed proof; user answered the previously pending I7 fork.

- re-cut: 2026-09-25 — fork: user accepts exact guarantee without artificial other-mode/version bans. Existing scenario proof reused unchanged; binary ceiling follows explicit user amendment and ADR-0467. Native oracle and Chromium5502/5504 evidence recorded in reference; no prospective pass fabricated.
