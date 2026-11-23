---
area: runtime-js
status: draft
title: "The isolate's fatal report shows an `[eval]` frame Node's stack-trace limit would cut"
created: 2026-11-23
why: Node counts its own `node:internal` frames against `Error.stackTraceLimit` (10), so a `-e` error thrown under a callback or catch loses its bottom `[eval]` frame; rifty has none of those frames and prints one more real `-e` frame
sources: [docs/public/compat/isolate-host.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Carrier rows `rethrow-in-catch`, `throw-in-callback`
(`packages/isolate-host/tests/node-file.test.ts`, pins in
`tests/browser-unit/fixtures/node-file-pins.json`): rifty prints
`at [eval]:1:304` below the file frames, Node v24.16.0 does not — its limit was
spent on `node:internal` frames. The frame is the program's own, at its own
position; not a rifty frame. Accepted as outside the fatal report's frame
contract by the manager's reading (ADR-0571, 2026-11-23), not the user's words.
Matching it would mean counting Node's internal frames rifty does not have.

Owner: runtime-js (fatal report); trigger: a user or agent report that the
extra frame misleads, or an engine-level frame budget the guest can read.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
