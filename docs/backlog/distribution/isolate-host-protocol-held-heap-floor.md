---
area: distribution
status: draft
title: isolate-host `protocol.test.ts` «accepted output is copied» reds on a negative GC heap delta (`held` < 0)
created: 2026-11-26
why: A row red by its measurement, not by the product, costs a PR a rerun and teaches reviewers to rerun reds.
sources: [https://github.com/vanilla-wave/rifty/actions/runs/45735837691/job/139629578371]
code: [packages/isolate-host/tests/protocol.test.ts]
---

## Context

CI, PR #459 head `622566a69` (its diff changes no `packages/isolate-host/src` file), run
`45735837691` attempt 1, job `unit-and-conformance (run)`: `protocol.test.ts:191`
«consumer treats the child channel as hostile > accepted output is copied, never kept as views into
received buffers» — `AssertionError: expected -0.37096405029296875 to be greater than or equal to 0`.
Attempt 2 of the job green; the row green locally
(`npx vitest run packages/isolate-host/tests/protocol.test.ts -t "accepted output is copied"`, macOS
arm64, Node v24.16.0).

The row: `held` = `(heapUsed + arrayBuffers)` after `globalThis.gc()` 4.5 s into the call, minus the
same `used()` (also after `gc()`) taken before `runCode` is called, in MiB; it expects
`0 ≤ held < 4` (the 2^16 one-byte frames are held in one 64 KiB buffer, not 2^16 chunk objects).

Open: the floor 0 assumes the post-`gc()` baseline holds nothing a later `gc()` frees; why the delta
went negative on this run is not established. Not the wall-clock class of
`distribution/isolate-host-time-phase-rows-under-load` (no clock, no extreme load).

Owner: next isolate-host test-hygiene pickup; trigger: this row red again.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
