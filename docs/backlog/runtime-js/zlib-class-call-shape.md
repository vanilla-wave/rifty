---
area: runtime-js
status: draft
title: "`zlib` stream classes called without `new` or via `X.call(this)` construct (Gzip) or reach their named ceiling, as Node's callable constructors do"
created: 2026-11-18
why: Node 24's zlib classes (except Zstd*) are callable legacy constructors; rifty's ES classes throw V8's bare class-constructor TypeError, so the PR #403 reasoned ceiling is never reached on that path
sources: [docs/adr/runtime-js/0178-node-zlib-gzip-transform-stream-subset.md, docs/adr/runtime-js/0353-callable-node-stream-constructors-preserve-legacy-initialization.md, docs/backlog/net/http-agent-call-shape.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/io/src/streams/callable-constructor.ts]
---

## Context

This was found while PR #403 was being delivered: the PR body lists it as an outside finding.
`http.Agent` has the same defect class (`net/http-agent-call-shape`).

Node v24.16.0, probe 2026-11-18:
- `Gzip`, `Gunzip`, `Deflate`, `Inflate`, `DeflateRaw`, `InflateRaw`, `Unzip` and `Brotli*` are
  `function X(opts) { if (!(this instanceof X)) return deprecateInstantiation(X, 'DEP0184', opts); … }`.
  - Calling one without `new` gives a working stream and one DEP0184 per process.
  - `util.inherits(Sub, zlib.X); zlib.X.call(this, o)` initializes in place, with no warning.
- `ZstdCompress` / `ZstdDecompress` are ES classes: calling them throws `TypeError: Class constructor ZstdCompress cannot be invoked without 'new'`.
- `name` and `length` are `"Gzip"` 1, and the same for the others.

Rifty @ 39cf60307 (guest `require('zlib')` via `runNodeEntry` eval):
- `Gzip()` and `Gzip.call(this)` throw `TypeError: Class constructor Gzip cannot be invoked without 'new'`.
- The 10 `unsupportedClass` ceilings (`zlib.ts:61`) are anonymous classes (`name` `""`, `length` 0). Calling one throws `TypeError: Class constructors cannot be invoked without 'new'`. Only `new` reaches the reasoned `NotImplementedError`.
- `stream.Transform()` and `inherits` + `Transform.call` work (ADR-0353).

Consumer shape: pngjs `lib/sync-inflate.js`, bundled in playwright-core 1.60.0
`utilsBundle.js`. It does `util.inherits(Inflate, zlib.Inflate)` + `zlib.Inflate.call(this, opts)`
for `PNG.sync.read`. Node → ok; rifty → bare TypeError.
- That path also needs a sync engine and zlib internals, so the best rifty
  outcome there is the reasoned ceiling.

Coverage gaps:
- `zlib-ceiling-reasons.test.ts` keeps only `NotImplementedError`s, so the call path is skipped.
- `zlib/surface.case.ts` pins `typeof` only.
- compat `zlib.md`'s "every throwing export names its working async alternative" holds for `new` only.

## Next

Owner runtime-js, with the next zlib stream work or a guest reaching the call
form. The fix shape for each class:
- `Gzip`: callable via ADR-0353's `makeCallableStreamConstructor`, which is
  io-package-private (exporting it is a public-API ADR), or zlib-local. Its setup moves
  to a receiver initializer, and DEP0184 is emitted once.
- Ceilings: a named function with `length` 1 whose call and construct paths both
  throw the reasoned ceiling. `Zstd*` keep Node's TypeError, named.

Parity first: no-`new`, `inherits` + `call`, `name` / `length`.

The pattern recurs: EventEmitter, streams and StringDecoder are fixed; http.Agent
and zlib are open. A repo-wide inventory of the remaining ES-class builtins is
not taken.
