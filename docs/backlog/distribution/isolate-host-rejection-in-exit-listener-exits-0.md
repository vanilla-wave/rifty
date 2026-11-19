---
area: distribution
status: draft
title: Isolate host — a promise rejected inside an `'exit'` listener exits 0 with no diagnostic
created: 2026-11-19
why: Silent false success: Node exits 1 with the rejection's `[eval]` diagnostic; runCode exits 0, stderr empty.
sources: [docs/public/compat/isolate-host.md, docs/backlog/runtime-js/process-exit-listener-effects.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Found 2026-11-19 while checking `isolate-host-unhandled-rejection-lost-to-gc` (macOS arm64, Node v24.16.0,
isolated-vm 7.0.2 @ f405533a7):

`process.on('exit', () => { Promise.reject(new Error('r')) })` → `node -e` exit 1, stderr `[eval]` diagnostic
`Error: r`; `runCode` `{stdout: '', stderr: '', exitCode: 0}`. Same with stock isolated-vm and with one rebuilt
without `SetWeak()`, and with or without allocation after the rejection: not the GC loss. With the rebuilt addon,
the child logs that `onUnhandledRejection` fires, but delivering it to the guest fails `Isolate is disposed`:
the run's terminal was already reported. Cause beyond that unverified (where Node's natural exit still processes
rejections from `'exit'` listeners vs rifty's eval lifecycle ending at `exit()`). Neighbour, different surface:
`runtime-js/process-exit-listener-effects` (throw / `exitCode` in `'exit'`). Owner: next isolate-host
runtime-fidelity pickup; trigger: any change to the eval lifecycle's exit path.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
