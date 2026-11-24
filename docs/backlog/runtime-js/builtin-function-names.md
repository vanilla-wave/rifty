---
area: runtime-js
status: draft
title: "A builtin function's `name` reads as Node's"
created: 2026-11-23
why: "`path.dirname.name` is `dirname2`, `setTimeout.name` `setTimeout2`, `fs.ReadStream.name` `FileReadStream` in the isolate guest; Node prints its own names, also as `[Function: dirname]` in inspect"
sources: [docs/backlog/runtime-js/reference/guest-builtin-names-baseline.md]
code: [packages/isolate-guest/scripts, packages/runtime-js/src/builtins]
---

## Context

Names sweep 2026-11-23 (PR #425, isolate guest vs Node v24.16.0;
`runtime-js/reference/guest-builtin-names-baseline.md`): 113 of 404 builtin
module exports and globals differ — 39 bundler suffixes, the rest rifty's
implementation names where Node has its own (Node's are not always the export
name: `wrappedFn`, `bound _format`, `''`). The constructors the fatal report
prints are unit `runtime-js/guest-builtin-names`; this is the rest. Browser
hosts not swept. Fault class `sibling-drift` (source name vs public name).

Stream prototype methods (PR #433 reviews, re-measured 2026-11-24, Node v24.16.0): Node's
`Readable/Writable/Duplex/Transform/PassThrough.prototype` methods are mostly enumerable and
anonymous (`name` `''`: `_read`, `_write`, `write`, `end`, `push`, `_transform`, …); named ones are
`destroy`, `_undestroy` (`undestroy`), `setDefaultEncoding`, `compose`, `Transform._final` (`final`)
and the iterator helpers (`map`, `filter`, … — those non-enumerable). rifty's are class methods:
non-enumerable, named by their key. Identity-shared values (`Writable/Duplex.prototype._writev`
`null`, `Duplex.prototype._write === Writable.prototype._write`, `Transform.prototype._final`) match
Node in identity and enumerability; `Duplex.prototype._write.name` is `_write` (Node `''`).
Observable: `Object.keys(Writable.prototype)` → rifty `_writev`, Node
`pipe,write,cork,uncork,setDefaultEncoding,_write,_writev,end,destroy,_undestroy,_destroy`;
`Object.keys(Transform.prototype)` → rifty `_final`, Node `_final,_transform,_write,_read`; `for…in`
over a Transform instance misses the prototype `_write` (and `_transform` unless an option set it).

Owner: runtime-js with isolate-guest (bundle). Trigger: a package or agent
reading a builtin's `name` (feature detection, logging), or the
`guest-builtin-names` unit's by-construction check landing.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
