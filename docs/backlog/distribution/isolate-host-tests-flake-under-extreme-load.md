---
area: distribution
status: draft
title: Three isolate-host tests fail under extreme CPU load (time tolerance or worker loss), green in isolation
created: 2026-11-19
why: A flaky red in the package gate costs every PR touching isolate-host a rerun and hides real reds.
sources: [docs/process/rules/testing.md]
code: [packages/isolate-host/tests/guest-export.test.ts, packages/isolate-host/tests/pool-faults.test.ts, packages/isolate-host/tests/protocol.test.ts]
---

## Context

PR #413 @ 4f0c57c43 (tests-only diff in `corpus.ts`, none of these files import it): `pnpm vitest run --project
isolate-host` 10 times on macOS arm64 (12 cpus) with 8 `yes` processes plus other sessions — load average 20 at
start, up to 188 — 7/10 green; one failure each in runs 5, 6, 8, all in tests the diff does not touch:

- `guest-export.test.ts:19` "timeOrigin + now() is the wall clock": stdout `false true` — the 50 ms tolerance
  between two host clock reads (`guest-export.test.ts:21-23`).
- `pool-faults.test.ts:472` "intervals created and cleared in a loop": culprit `exitCode` `undefined`, not `null`
  (the call did not end as `timeout`/`memory` with a result).
- `protocol.test.ts:167` "a child that closes the channel and exits is reported by its own exit code": received
  `code null, signal SIGKILL … after closing its result channel without a result`, expected `code 7`.

The three files rerun together in isolation (load ~116 from other sessions): 59/59 green. Not reproduced on main
separately. Owner: next isolate-host test-hygiene pickup; trigger: any of the three reds in CI. Lead: a time
tolerance (first) and process-timing races under load (others) where the rule is waiting on events.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
