---
area: runtime-js
status: draft
title: An async fs callback runs before a microtask queued after it; Node runs it after
created: 2026-11-22
why: Node completes fs requests on the libuv poll phase, after the current microtasks; rifty delivers the callback within the same microtask checkpoint, ahead of promise callbacks queued later — observable ordering differs.
sources: [docs/backlog/runtime-js/node-eval-work-queued-at-exit-runs.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Isolate host @ PR #416 (2026-11-22), `node -e` v24.16.0:
`require('fs').stat('.', () => console.log('fs')); Promise.resolve().then(() => console.log('micro'))` → Node
`micro\nfs`, `runCode` `fs\nmicro`; with `readFile('nope', cb)`, `queueMicrotask` and `nextTick`: Node
`tick\nmicro\nfs`, rifty `tick\nfs\nmicro`. Browser `node -e` and kernel children share the fs module (unprobed there).
Found by PR #416 external review while probing work queued at `exit()`.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
