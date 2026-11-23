---
area: runtime-js
status: draft
title: "`emitter.listenerCount(name, listener)` counts only `listener`, as Node 18.16+"
created: 2026-11-17
why: rifty's `listenerCount` ignores its second argument and returns every listener for the event
sources: [PR #400 alias-identity sweep]
code: [packages/io/src/event-emitter.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (PR #400). Parity
runner, Node v24.16.0 vs rifty, scratch CJS case:
`const ee = new EventEmitter(); const f = () => {}; ee.on('x', f); ee.on('x', () => {}); console.log(ee.listenerCount('x', f));`
→ Node `1`, rifty `2`. Node's `listenerCount.length` is 2, rifty's 1.

## Next

Owner runtime-js. Trigger: a consumer passing a listener to
`listenerCount`. Parity first: the probe above plus a `once` wrapper (Node
matches the original via `.listener`).
