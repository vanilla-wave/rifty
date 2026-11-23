---
area: distribution
status: draft
title: Isolate host — code longer than memoryLimitMb / 8 is refused with EvalError
created: 2026-11-19
why: A program Node runs fails in runCode with a misleading EvalError when its source passes an eighth of its memory limit.
user_story: As a service sending a large generated script, I want it run as `node -e` runs it, but today code over memoryLimitMb / 8 MiB exits 1 with "Code generation from strings disallowed".
sources: [docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Finding (cross-review round 3 of PR #412). Reproduced 2026-11-19, macOS arm64, Node v24.16.0, isolated-vm 7.0.2, branch
`t3/isolate-host-worker-pool`: `runCode('console.log(1)//' + 'x'.repeat(N << 20), { memoryLimitMb: L })` →

| N MiB | L | result |
|---|---|---|
| 7 | 64 | exit 0, `1` |
| 9 | 64 | exit 1, `EvalError: Code generation from strings disallowed for this context` |
| 31 | 256 | exit 0 |
| 33 | 256 | exit 1, same EvalError |

`node -e` runs such code up to the OS argument limit (128 KiB per argument on Linux, ~1 MiB total on macOS), so Node cannot take these sizes as `-e`; a `node file.js` of the same size runs. The threshold matches memoryLimit / 8. Hypothesis, unverified: isolated-vm or V8 refuses an `eval` source over a fraction of the heap limit and reports it through the code-generation callback. Open: whether the guest's eval path (rifty `runNodeEvalScript`) can compile the source another way, or the gap should be named.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
