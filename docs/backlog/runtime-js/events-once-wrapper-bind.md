---
area: runtime-js
status: draft
title: "`EventEmitter#once` builds its wrapper as Node's `_onceWrap` does, through the live `Function.prototype.bind`"
created: 2026-11-26
why: Node's `once` wraps the listener with `onceWrapper.bind(state)` read live, so a guest's replaced `bind` reaches it; rifty's `once` does not, and a program that Node fails runs on
sources: [tests/integration/node-streams-differential/programs/p1-intrinsics-replaced.cjs, docs/backlog/runtime-js/stream-core-node-sources-unwired.md]
code: [packages/io/src/event-emitter.ts]
---

## Context

Stream core 8a differential (PR #471, 2026-11-26, Node v24.16.0, in-process), row
`p1-intrinsics-replaced: Function.prototype.bind throws` (`Function.prototype.bind` replaced by a
throwing function after load, then a pipeline): live Node and the core on Node's bindings
`threw replaced bind called` — Node's `lib/events.js` `_onceWrap` calls `onceWrapper.bind(state)`
(stack `_onceWrap (node:events:637)`, `Transform.once`, `Readable.pipe`); the core on rifty's
bindings completes (`A.B.C. 12 hello intrinsics finished:ok`): io's `once` builds no bound wrapper.
The row is pinned in `tests/integration/node-streams-differential.test.ts` with this item as owner.
Not the class of `runtime-js/post-guest-paths-use-replaceable-intrinsics` (capturing intrinsics
cannot make it equal: Node reads this one live).

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
