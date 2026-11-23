---
area: runtime-js
status: draft
title: Stream internals register their listeners through Node's methods (`prependListener('error')`, `once`)
created: 2026-11-17
why: `Readable.pipe`, `pipeline` and `readline` attach every internal listener with `on`; Node prepends the destination's `'error'` handler and uses `once` for `'close'`/`'finish'`/`'end'`, so ordering against guest listeners and overrides of `once`/`prependListener` diverge
sources: [docs/process/rules/fault-classes.md §Boundary failure models (builtin prototype → guest subclass/patch)]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/pipeline.ts, packages/runtime-js/src/builtins/null-net-stubs.ts]
---

## Context

REV-12 discovery (cross-review) of the `on === addListener` alias unit
(branch `t3/w1-eventemitter-alias`), whose sweep moved internal detaches to
`removeListener`; the attach side predates it. Parity runner, Node v24.16.0
vs rifty: subclasses of `Readable`/`Writable`/`PassThrough` overriding `on`,
`once` and `prependListener` (each logs `method:event`, then calls `super`),
`r.pipe(w)`, `readline.createInterface({ input, terminal: false }).close()`,
`pipeline(src, dest, cb)` (meta events filtered):

| receiver | Node | rifty |
|---|---|---|
| pipe src | `once:end, on:end, on:data` | `on:data, on:end, on:error` |
| pipe dest | `on:unpipe, prepend:error, once:close, on:close, once:finish, on:finish` | `on:drain, on:error, on:close` |
| readline input | `on:prefinish, on:error, on:data, on:end` | `on:data, once:end, on:end, once:close, on:close` |

Observable: a guest `'error'` listener on the destination runs before
`pipe`'s in rifty, after it in Node; a `once`/`prependListener` override
misses pipe's registrations. Destination `'pipe'`/`'unpipe'` events:
`runtime-js/pipe-unpipe-destination-events`.

## Next

Owner runtime-js. Trigger: a consumer ordering its `'error'` handler against
`pipe`'s, or overriding `once`/`prependListener` on a stream; or the next
`Readable.pipe` unit. Parity first: the probe above per receiver.
