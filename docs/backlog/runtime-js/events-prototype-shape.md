---
area: runtime-js
status: draft
title: "`EventEmitter.prototype` carries Node's own-property shape: enumerable methods, no rifty helper names, two-argument `listenerCount`"
created: 2026-11-17
why: rifty's emitter prototype is a TS class — methods are non-enumerable and private helpers sit on it as guest-visible names — so `for…in` mixins copy nothing, a guest `this.warned = …` throws, and `listenerCount(name, fn)` ignores `fn`
sources: [docs/process/rules/fault-classes.md §Boundary failure models (builtin prototype → guest subclass/patch)]
code: [packages/io/src/event-emitter.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (branch
`t3/w1-eventemitter-alias`; that unit fixed alias identity only). Parity
runner, Node v24.16.0 vs rifty, scratch case (`'use strict'` CJS):

```js
function merge(a, b) { for (var key in b) a[key] = b[key]; return a; } // utils-merge (connect createServer)
const app = merge(function app() {}, EventEmitter.prototype);
console.log('mixin', typeof app.on, typeof app.emit, Object.keys(EventEmitter.prototype).length);
class Flagged extends EventEmitter { constructor() { super(); this.warned = false; } } // try/catch → name
ee.on('x', f); ee.on('x', () => {}); console.log('listenerCount2', ee.listenerCount('x', f));
```

| probe | Node | rifty |
|---|---|---|
| for…in mixin | `function function 18` | `undefined undefined 0` |
| guest `this.warned = false` | ok | `TypeError` (getter-only accessor `warned` on the prototype) |
| `listenerCount('x', f)` | `1` | `2` |

Node's own keys: `_events`, `_eventsCount`, `_maxListeners`, the enumerable
methods, `Symbol(kCapture)`. rifty's add `listenersMap`, `warned`
(accessors), `emitNewListener`, `emitNew` (methods a guest subclass can
clobber). `EventEmitter.length` 1 vs 0.

## Next

Owner runtime-js (`node:events` via `@riftydev/io`). Trigger: a claimed
consumer using a `for…in`/`Object.assign` emitter mixin (connect apps' `.on`),
or a guest emitter field colliding with a helper name. Parity first: the probe
above as a `node:events` case; `_events` exposure is a separate decision (code
reads `emitter._events` directly).
