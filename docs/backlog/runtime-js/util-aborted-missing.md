---
area: runtime-js
status: draft
title: rifty's `node:util` has no `util.aborted`
created: 2026-11-25
why: Node 24's `util.aborted(signal, resource)` (a promise that settles when the signal aborts) is `undefined` in rifty, so a caller gets `TypeError: util.aborted is not a function`
sources: [docs/backlog/epics/isolate-guest-web-api/reference/today/README.md]
code: [packages/runtime-js/src/builtins/util.ts]
---

## Context

Probe `isolate-guest-web-api/reference/today` (2026-11-25, main bc3412420, Node v24.16.0):
`typeof util.aborted` → Node `function`, isolate guest `undefined` (`exec` and `runCode`). Every
host by source (`builtins/util.ts` exports no `aborted`). Node's is in `lib/util.js` over
`internal/abort_controller`'s `aborted`. No compat row yet. Owner runtime-js `node:util`; trigger:
a package calling it, or the isolate `AbortController` unit (`node-streams-as-in-node` unit 7)
bringing Node's `abort_controller.js`.

## Challenge

challenge: 2026-11-25 — not run (factual capture)
