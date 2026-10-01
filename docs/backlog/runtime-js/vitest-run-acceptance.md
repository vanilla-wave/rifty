---
area: runtime-js
status: ready
title: e2e acceptance — the vitest scenario runs on both pools and the compat page claims the exact pair
created: 2026-09-15
why: the goal closes only on observable proof: a Chromium e2e running the scenario (install, failing run exit 1, fixed run exit 0, threads == forks) plus a `vitest.md` page in `docs/public/compat/` with ✅/❌ rows — source greps and shimmed probes do not close acceptance
epic: vitest-run-in-browser
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

## Reference contract

Node v24.16.0 + npm 11.17.0, vitest 4.1.11 / vite 8.0.16;
executed oracle and captured runtime failures: `reference/vitest-run-in-browser-evidence.md`.

## Acceptance

1. Clean npm-spelled override installs one vite 8.0.16; legacy spelling works. → I1
2. Referenced Worker keeps parent alive through message and exit; unref releases it. → I2
3. Uncaught/rejection handlers continue execution; exit event and inherited exitCode match Node. → I3
4. Config.ts/include and TS tests: forks fail with reporter/diff + exit 1, fix passes exit 0; npm test and verbose agree. → I4
5. Threads report the same pass/fail and exit codes. → I5
6. Claimed module tree loads; unavailable unclaimed calls fail with named ceilings. → I6
7. Compat page pins exact versions/manifest, proven positive rows and loud negative rows. → I7

## Parity cases

- npm-spelled override: existing npm oracle + parser regression and real browser install. → I1
- Worker reference/lifecycle/stdio: same real files on Node and physical runtime workers. → I2 + I5
- Process exception/rejection/exit events and exitCode: identical scripts. → I3
- Builtin names/path subpaths/Symbol writes/vm offsets: identical loader scripts. → I6
- Real Vitest config/test files, both pools and reporter counts/exit codes. → I4 + I5

## Fault matrix

- observable-order × Worker exit: final message/stdio precede exit; parent drains after terminal. → I2 + I5
- sibling-drift × IPC serialization: advanced preserves cloneable values both directions, JSON remains default, uncloneable send is loud. → I4
- observable-order × process terminal: handled errors continue; exit callback precedes final terminal. → I3

## Out of scope

- Goal map exclusions remain loud; no resolver/hoisting work or real heap statistics.

## Decisions

re-cut: 2026-10-01 — absorbs goal items 1–11 into composed Vitest regression delivery; wall-level oracle/RED before each repair — trace: none
- 2026-10-01 — preparation follows captured observed defects (Node oracle + reproduced RED); speculative new stateful behavior requires Contract+RED before implementation (`RDY-8`).
