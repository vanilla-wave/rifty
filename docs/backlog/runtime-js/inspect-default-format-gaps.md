---
area: runtime-js
status: draft
title: util.inspect default format — classes as functions
created: 2026-11-18
why: Node's default inspect prints `[class A]`; rifty's inspector (console, util.inspect, -p) prints `[Function: A]`.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/repl/inspect.ts]
---

## Context

`node -e "console.log({ get g() { return 1 } }, class A {}, [1, , 3], new Array(3))"`
→ Node v24.16.0 `{ g: [Getter] } [class A] [ 1, <1 empty item>, 3 ] [ <3 empty items> ]`;
rifty (isolate host, ADR-0557; same inspector in the browser realms)
`{ g: 1 } [Function: A] [ 1, , 3 ] [ , ,  ]`. Calling the getter is also an
observable side effect Node does not perform. Found by the PR #405
cross-review. Neighbour, not duplicate: `runtime-js/util-surface-completions`
owns inspect *options* (depth, breakLength, getters: true, …) and the
typed-array / grouping layout gaps; these three are default-format defects.

2026-11-22 — getters (`[Getter]`, never run) and holes (`<N empty items>`)
fixed in PR #421 (`repl/inspect.ts`); the class form remains.

2026-11-24 (PR #432 review, isolate `runCode` vs `node -e`, v24.16.0): two more in Node's error
`Received …` text. A 200-char string (`process.umask('a'.repeat(200))`, ERR_INVALID_ARG_VALUE):
Node inspects it whole and `internal/errors` cuts at 128 + `...` (message 214 chars), rifty's
inspector cuts the string itself (`…'`, 206 chars). `Object.create(null)`
(`describeReceived`, ERR_INVALID_ARG_TYPE): Node `[Object: null prototype] {}`, rifty `[Object]`.

2026-11-24 (probe of the `%s` dispatch unit, PR #449, `util.format('%s', v)` = inspect at
depth 0, parity-runner and isolate `runCode` vs `node -e` v24.16.0): `class T { get
[Symbol.toStringTag]() { return 'Tag' } }` → Node `T [Tag] {}`, rifty `T {}`;
`Promise.resolve(1)` → Node `Promise { 1 }`, rifty `Promise { <pending> }` (a pure-JS realm
cannot read a promise's state synchronously); `new WeakMap()` → Node
`WeakMap { <items unknown> }`, rifty `WeakMap {}`. Same probe (critic, verified):
`Object.create(Date.prototype)` → Node `Date {}`, rifty throws `TypeError: Method
Date.prototype.toISOString called on incompatible receiver`; `{ a: 1, [Symbol('k')]: 2 }` →
Node `{ a: 1, Symbol(k): 2 }`, rifty `{ a: 1 }`; `arguments` → Node `[Arguments] { '0': 1 }`,
rifty `{ 0: 1 }`; `class D extends Date`, `class M extends Map` → Node `D 1970-…`,
`M(1) [Map] { 1 => 2 }`, rifty no prefix; `new ArrayBuffer(2)` → Node
`ArrayBuffer { [Uint8Contents]: <00 00>, [byteLength]: 2 }`, rifty `ArrayBuffer {}` (also
`DataView`); `Math`, an array iterator → Node `Object [Math] {}`, `Object [Array Iterator] {}`,
rifty `{}`.

2026-11-25 (PR #449 external review, verified in-process vs `node -e` v24.16.0), reached
through `%s`'s inspect branch: a vm context's `Map`/`Set` → Node `Map(1) { 1 => 2 }`, rifty
`Map {}`; `new TextEncoder()` → Node `{ encoding: 'utf-8' }`, rifty `TextEncoder {}`;
`new Headers({ a: '1' })` → Node `Headers { a: '1' }`, rifty `Headers {}`;
`AbortController`/`Blob`/`Event` → Node `AbortController [Object]` …, rifty `AbortController {}` …;
`new Intl.NumberFormat('en')` → Node `NumberFormat [Intl.NumberFormat] {}`, rifty
`NumberFormat {}`; `Object.create({ constructor: Map, toString() {} })` → Node `{}`, rifty
`Map {}`.

2026-11-26 (stream core 8a differential, PR #471, `p3-function-names`): a function's own
properties are not printed — `util.inspect(Readable)` Node `[Function: Readable] { ReadableState: …,
from: [Function (anonymous)], … }`, rifty `[Function: Readable]`; `pipeline` Node
`[Function: pipeline] { Symbol(nodejs.util.promisify.custom): [Getter] }`. Pinned there.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
