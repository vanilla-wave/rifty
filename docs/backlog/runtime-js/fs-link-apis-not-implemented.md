---
area: runtime-js
status: draft
title: fs link APIs (symlink, link, readlink and their promise/callback forms) are absent instead of a loud NotImplementedError
created: 2026-11-22
why: rifty's VFS has no links (ADR-0050), but `fs.symlinkSync` is `undefined`, so a guest gets `TypeError: fs.symlinkSync is not a function` instead of the named gap (AGENTS.md §Fidelity).
epic: isolate-host-live-sandbox
blocked_by: []
sources: [docs/backlog/distribution/isolate-host-sandbox-acceptance.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Probe 2026-11-22 (`runCode` on 50c9d8bf1): `fs.symlinkSync('a','b')` and
`fs.linkSync('a','c')` throw `fs.symlinkSync is not a function` /
`fs.linkSync is not a function`; `typeof fs.symlinkSync` is `undefined`. Node
24.16.0 creates the links. Carrier row 12 of the sandbox acceptance asserts
`Not implemented: fs.symlinkSync`. Exact member list (sync, callback,
`fs.promises`) compiled at PICKUP against Node's `fs` keys.

## Challenge

challenge: 2026-11-22 — inherits the goal premise check (`docs/backlog/epics/isolate-host-live-sandbox/goal.md` §Challenge)
