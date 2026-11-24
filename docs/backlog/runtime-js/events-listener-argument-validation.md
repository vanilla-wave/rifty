---
area: runtime-js
status: draft
title: EventEmitter rejects a non-function listener with ERR_INVALID_ARG_TYPE
created: 2026-11-24
why: rifty's EventEmitter stores any listener value, so `on('x', 'notfn')` succeeds and the later `emit` throws `TypeError: listener.apply is not a function` where Node throws at registration
sources: [docs/backlog/runtime-js/fs-stream-close-method-missing.md]
code: [packages/io/src/event-emitter.ts]
---

## Context

Discovered during `runtime-js/fs-stream-close-method-missing` (2026-11-24): Node's
`fs.WriteStream#close('notfn')` throws from `this.on('close', cb)` and leaves the stream open;
rifty registers it and crashes at `'close'`. Scratch parity case, Node v24.16.0 vs rifty
@ 82a7738c7:

```
e.on('x', 'notfn') / once / prependListener / prependOnceListener / removeListener
node:  ERR_INVALID_ARG_TYPE The "listener" argument must be of type function. Received type string ('notfn')
rifty: accepted
e.emit('x')
node:  emit ok          rifty: TypeError listener.apply is not a function
```

`addListener`/`prependListener` (`event-emitter.ts`) push without a type check. Every
emitter is affected (streams, process, http). Dedup: grep `must be of type function` /
`listener` over `docs/backlog/runtime-js` — `timer-callback-not-validated` (timers, a
sibling validation gap), `events-listener-count-listener-arg` (`listenerCount`'s argument),
no match for registration.

Owner: runtime-js (io events). Trigger: a program relying on the registration-time throw,
or the next EventEmitter parity unit.
