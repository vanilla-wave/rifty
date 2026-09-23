---
area: runtime-js
status: draft
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/❌ rows — source greps and shimmed probes do not close acceptance
epic: vitest-run-in-browser
blocked_by: [runtime-js/process-lifecycle-events-exit-code, runtime-js/worker-threads-handle-keepalive, runtime-js/child-process-advanced-ipc-serialization, runtime-js/worker-threads-stdio-streams-empty-exec-argv]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/package-tooling.md, docs/public/compat/vite-command.md]
code: [tests/e2e/owner-shell-prettier-eslint.spec.ts, tests/e2e/npm-lock-replay.spec.ts, docs/public/compat/README.md]
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
I7), then I1–I6 ✅ and jsdom/happy-dom, watch, coverage, browser mode, vm
pools, other versions ❌ each naming its loud throw. Reporter output is
asserted on pass/fail lines and counts, not timing/ANSI (goal I4). The page is
registered in the compat README index. Exact assertions are compiled at
PICKUP; this lists what the goal's scenario needs.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P5 exact pair)
