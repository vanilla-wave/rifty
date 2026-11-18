---
area: runtime-js
status: draft
title: process.abort is missing instead of a loud NotImplementedError
created: 2026-11-18
why: Node has `process.abort()`; rifty's process shim omits it, so guest code gets `TypeError: process.abort is not a function` instead of a named gap.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/loud-members.ts]
---

## Context

`node -e "process.abort()"` → aborts (signal SIGABRT). rifty (isolate host
ADR-0557, and the browser realms share the shim) → `TypeError: process.abort
is not a function`. Fidelity asks for `NotImplementedError('process.abort')`
(the `loud-members.ts` pattern) so the gap names itself. Found by the PR #405
cross-review (round 2). Open: whether the isolate host could honour it as a
real abort (the child could exit on a signal), which would be a separate
contract.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
