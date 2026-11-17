---
area: runtime-js
status: draft
title: "`Readable` starts flowing on `'data'` without a guest-removable `'newListener'` listener, as Node's `Readable.prototype.on`"
created: 2026-11-17
why: rifty's Readable registers its data/readable start hook as an ordinary `'newListener'` listener, so a guest `removeAllListeners()` deletes it and a later `on('data')` never flows; Node keys flow to its `on` override
sources: [docs/process/rules/fault-classes.md §Boundary failure models (builtin prototype → guest subclass/patch)]
code: [packages/io/src/streams/callable-constructor.ts, packages/io/src/streams/readable.ts, packages/runtime-js/src/builtins/process-stdin-reader.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (branch
`t3/w1-eventemitter-alias`). `initializeReadable` adds
`handleReadableNewListener` with `target.on('newListener', …)`
(`callable-constructor.ts`). Node's Readable overrides `on` (aliased to
`addListener`, `off`/`removeListener` likewise) and registers no listener.

Parity runner, Node v24.16.0 vs rifty, scratch CJS case:

```js
const r = new Readable({ read() {} });
console.log('newListener count', r.listenerCount('newListener'));
r.removeAllListeners();
r.on('data', (c) => console.log('data', String(c)));
r.push('x'); r.push(null);
setTimeout(() => console.log('flowing', r.readableFlowing), 20);
```

Node: `newListener count 0` / `data x` / `flowing true`. rifty:
`newListener count 1` / `flowing undefined` — no data (`readableFlowing`
itself is absent: `runtime-js/readable-flowing-property`).

Same root, the other direction: Node's `prependListener('data', fn)` bypasses
the `on` override and never starts flowing. Same harness, `new Readable({
read() {} }).prependListener('data', …)` + `push('x')`, then (`stdin: 'in'`)
`process.stdin.prependListener('data', …)`: Node prints neither chunk,
`flowing null`; rifty prints `prepend data x` and `stdin prepend data in`
(the hook sees every add; `NodeStdinEmitter`'s `prependListener` override
starts stdin). Likewise `EventEmitter.prototype.on.call(r, 'data', fn)`: Node
does not flow (`readableFlowing null`), rifty prints `base-on data y`.
Shape: Node `Object.hasOwn(Readable.prototype, 'on')` true and `!==
EventEmitter.prototype.on`; rifty false / `===`. `Duplex` carries the hook
too (`listenerCount('newListener')` Node 0, rifty 1).

## Next

Owner runtime-js (`node:stream` via `@riftydev/io`). Trigger: a consumer that
clears a stream's listeners and re-attaches (stream recyclers, `readline`-style
re-wiring), or reads `readableFlowing`. Parity first: the probe above; the
`Readable.prototype.on` shape and `listeners('newListener')` follow Node.
