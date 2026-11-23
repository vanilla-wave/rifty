---
area: runtime-js
status: draft
title: "`EventEmitter` prototype and instance own properties match Node's: enumerable methods, Node's state keys, no rifty helper names"
created: 2026-11-17
why: rifty's emitter prototype is a TS class — methods are non-enumerable and private helpers sit on it as guest-visible names — so `for…in` mixins copy nothing and a guest `this.warned = …` throws (strict) or is silently dropped (sloppy)
sources: [PR #400 alias-identity sweep, docs/process/rules/fault-classes.md §Boundary failure models (builtin prototype → guest subclass/patch)]
code: [packages/io/src/event-emitter.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (PR #400, which fixed
alias identity only). Parity runner, Node v24.16.0 vs rifty, scratch CJS
cases:

```js
'use strict';
const EventEmitter = require('node:events');
function merge(a, b) { for (var key in b) a[key] = b[key]; return a; } // utils-merge, connect 3.7.0 createServer
const app = merge(function app() {}, EventEmitter.prototype);
console.log('mixin', typeof app.on, typeof app.emit, Object.keys(EventEmitter.prototype).length);
class Flagged extends EventEmitter { constructor() { super(); try { this.warned = false; console.log('ok'); } catch (e) { console.log(e.name); } } }
new Flagged();
```

| probe | Node | rifty |
|---|---|---|
| for…in mixin | `mixin function function 18` | `mixin undefined undefined 0` |
| `this.warned = false` (strict/class) | `ok` | `TypeError` (getter-only `warned` on the prototype) |
| same, sloppy: `o.warned = false; typeof o.warned` | `boolean` | `object` (assignment dropped) |
| `Object.keys(new EventEmitter())` | `["_events","_eventsCount","_maxListeners"]` | `["_listenersMap","_warned"]` |

Node's prototype own keys: `_events`, `_eventsCount`, `_maxListeners`, the
enumerable methods, `Symbol(kCapture)`. rifty's add `listenersMap`, `warned`
(accessors), `emitNewListener`, `emitNew` (methods a guest subclass can
clobber). `EventEmitter.length` 1 vs 0. The same `_listenersMap`/`_warned`
names leak as `node:process` ESM names: `runtime-js/process-non-ipc-member-over-export`.

Re-observed 2026-11-23 (PR #425, isolate guest vs Node v24.16.0):
`console.log(new (require('events'))())` prints `EventEmitter { _listenersMap:
Map(0) {  }, _warned: Set(0) {  } }`; Node prints `EventEmitter {` then
`_events: [Object: null prototype] {}`, `_eventsCount: 0`, `_maxListeners:
undefined`, `Symbol(shapeMode): false`, `Symbol(kCapture): false`, one per
line. `constructor.name` is `EventEmitter` in both (fixed there).

## Next

Owner runtime-js (`node:events` via `@riftydev/io`). Trigger: a claimed
consumer using a `for…in`/`Object.assign` emitter mixin (connect apps' `.on`),
or a guest emitter field colliding with a helper name. Parity first: the probe
above as a `node:events` case; exposing `_events` is a separate decision (code
reads `emitter._events` directly).
