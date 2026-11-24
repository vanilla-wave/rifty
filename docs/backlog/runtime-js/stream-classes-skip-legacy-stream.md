---
area: runtime-js
status: draft
title: rifty's Readable and Writable chain to EventEmitter without Node's legacy Stream, so a stream is not `instanceof Stream`
created: 2026-11-24
why: In Node `Readable.prototype` → `Stream.prototype` → `EventEmitter.prototype`; rifty's `Readable`/`Writable` extend `EventEmitter` directly (`packages/io/src/streams/legacy-stream.ts` "we collapse"), so `new Readable() instanceof require('stream')` is `false` where Node says `true`
sources: [docs/backlog/distribution/isolate-host-ceiling-modules-load.md]
code: [packages/io/src/streams/legacy-stream.ts, packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts]
---

## Context

Found while delivering `distribution/isolate-host-ceiling-modules-load` (its shape parity walks
the zlib classes' full chains). Same file run by Node v24.16.0 and by isolate `runCode`
(`packages/isolate-host/dist`, 2026-11-24), every value `===`-compared:

```js
const s = require('stream'), E = require('events');
console.log(Object.getPrototypeOf(s.Readable.prototype) === s.Stream.prototype,
  Object.getPrototypeOf(s.Readable) === s.Stream, new s.Readable() instanceof s.Stream,
  new s.PassThrough() instanceof s, Object.getPrototypeOf(s.Stream.prototype) === E.prototype,
  s === s.Stream, Object.getPrototypeOf(s.Writable.prototype) === s.Stream.prototype);
```

Node: `true true true true true true true`. rifty: `false false false false true true false`.
The code is `@riftydev/io`, shared by every host (browser hosts not run). A consumer check
`x instanceof Stream` (or `Stream.prototype.pipe` inherited by a `Writable`) diverges silently.
Undeclared in `docs/public/compat/streams.md`. Declared deviation in the isolate shape tests
(`ceiling-modules.test.ts`; `egress-modules.test.ts` prints one level only).
