---
area: runtime-js
status: ready
title: util.format('%s') picks Node v24.16.0's branch for every argument type
created: 2026-11-24
why: `%s` is how Node builds its own error messages and how CLIs log; rifty inspected where Node calls the value's toString or Symbol.toPrimitive, and printed -0 as 0 — silent, on every host.
sources: [packages/isolate-host/tests/egress-modules.test.ts, "PR #435 external review round 2"]
code: [packages/runtime-js/src/builtins/util.ts, packages/isolate-guest/src/guest/egress-http.ts]
---

## Context

Probe 2026-11-24, `util.format('%s', v)`, live `node -e` v24.16.0 vs rifty `origin/main`
b6d37fc01 — parity-runner (in-process) and isolate `runCode`, same text on both hosts:

| `v` | Node | rifty |
|---|---|---|
| `{ toString() { return 'o' } }` | `o` | `{ toString: [Function: toString] }` |
| `new (class A { toString() { return 'A' } })()`, its subclass | `A` | `A {}` / `B {}` |
| `Object.create({ toString() { return 'inh' } })` | `inh` | `{}` |
| `{ [Symbol.toPrimitive]: () => 'p' }`, a class with it | `p` / `P` | `{}` / `P {}` |
| `{ [Symbol.toPrimitive]() { throw new Error('PRIM') } }`, a throwing own `toString` | throws `PRIM` / `TS` (so `http.validateHeaderName(v)` throws it, not `ERR_INVALID_HTTP_TOKEN`) | `{}` / `{ toString: … }` |
| null-prototype object with own `toString`; transparent Proxy of `{ toString }` | `np` / `px` | `{ toString: [Function: toString] }` |
| `-0` | `-0` | `0` |
| `new Uint8Array([1, 2])`, `Buffer.from('ab')`, `new URL('http://a/b')` | `1,2` / `ab` / `http://a/b` | `Uint8Array { 0: 1, 1: 2 }` / `<Buffer 61 62>` / `URL {}` |
| instance of a user class named `Buffer`/`URL`/`Document`/… with `toString` | its `toString` | `Buffer {}` … |

Node's `%s` (`formatWithOptionsInternal`, Reference contract): a number via `formatNumber`, a
bigint `<n>n`, a non-object or an object without a built-in `toString` (`hasBuiltInToString`)
via `String()`, otherwise `inspect(v, { depth: 0, colors: false, compact: 3 })`. Built-in =
the constructor of the prototype owning the `toString`/`Symbol.toPrimitive` is named in
Node's `builtInObjects`, the `globalThis` names when `inspect.js` loads: V8's 47 globals,
before Node adds `Buffer`, `URL`, `TextEncoder`, … (live probe: a user class named
`SharedArrayBuffer` or `Buffer` with its own `toString` is `String()`ed). Reached by the
isolate guest's `http.validateHeaderName`/`validateHeaderValue` messages.

## Challenge

challenge: 2026-11-24 — existing-baseline repair; final check of the written result: see Decisions

## User scenario

An Express-style app in the isolate guest validates a header name built from an object:
`http.validateHeaderName({ toString() { return 'custom' } })` → Node
`TypeError [ERR_INVALID_HTTP_TOKEN]: Header name must be a valid HTTP token ["custom"]`;
rifty printed `["{ toString: [Function: toString] }"]`. With a throwing
`Symbol.toPrimitive` Node rethrows that error; rifty threw `ERR_INVALID_HTTP_TOKEN`.
A CLI logging `util.format('%s', -0)` or `util.format('%s', buf)` gets `-0` / the
buffer's text, as in Node.

## Acceptance

1. Parity `util/format-percent-s` (runtime-js in-process vs live Node): every row of
   Parity cases, plus the built-in name set — the user classes that `%s` inspects, over
   every Node `globalThis` name and `Document`/`HTMLElement`/`Window`/`Worker`, equal
   Node's; red on `origin/main` → scenario
2. Isolate corpus row `util-format-percent-s` (`parity.test.ts`, live `node -e`): own/class
   `toString`, `Symbol.toPrimitive`, its throw, `-0`, `1n`, `Buffer`, `Uint8Array`, `Date`,
   depth-0 objects, `Map`, user classes named `Buffer`/`URL`/`TextEncoder`/`SharedArrayBuffer`/
   `Document`/`Error`/`Map`/`Iterator`; red on `origin/main` → scenario
3. Isolate `egress-modules.test.ts`: the `validateHeaderName`/`validateHeaderValue` rows
   for `-0`, own `toString`, class `toString`, `Symbol.toPrimitive` and a new throwing
   `Symbol.toPrimitive` row are strict (no longer in `DECLARED_FORMAT_ROWS`) → scenario

## Reference contract

- Oracle: Node v24.16.0, `lib/internal/util/inspect.js` — `formatWithOptionsInternal`
  (`case 115`), `hasBuiltInToString`, `builtInObjects`, `formatNumber`; checked against live
  `node -e`.
- Mechanism: the same dispatch and prototype walk (primordials captured at load; a null end
  of the walk throws as Node's `ObjectPrototypeHasOwnProperty(null)`); `builtInObjects` as
  Node's measured name list.

## Parity cases

1. Own, class, subclass, inherited user `toString` → its result; own and class
   `Symbol.toPrimitive` → its result; a throwing one of either → that error → scenario
2. `toString: 1` (not a function) → inspected; a null-prototype object with own
   `toString` → its result; a transparent Proxy (`{}` handler) of either shape → as its
   target → scenario
3. Numbers `-0`, `0`, `1.5`, `NaN`, `-Infinity`, `1e21`; bigints `10n`, `-10n`; string,
   symbol, `null`, `undefined`, `true`, function, class → Node's text → scenario
4. Depth-0 inspect for a plain object, nested array, class without `toString`, `Map`,
   `Set`, `Error` (fixed stack); `String()` for `Date`, `RegExp`, `Uint8Array`, `Buffer`
   → scenario
5. `%s` without an argument stays literal (`'x %s y'`, `'%s:%s'` with one);
   `formatWithOptions({ depth: 5 }, '%s', …)` still depth 0 → scenario

## Out of scope

- The inspect text of what `%s` inspects: null-prototype objects (top level and nested),
  boxed primitives, an `Error`'s own props and `cause`, a long string —
  `runtime-js/inspect-null-prototype-prefix` (rows stay in `DECLARED_FORMAT_ROWS`);
  `Symbol.toStringTag`, a settled `Promise`'s state, `WeakMap`/`WeakSet` `<items unknown>`
  — `runtime-js/inspect-default-format-gaps`.
- A Proxy with traps: Node reads its target without running a trap, rifty runs
  `get`/`getOwnPropertyDescriptor`/`getPrototypeOf`; a revoked Proxy throws `TypeError`
  (Node `<Revoked Proxy>`) — `runtime-js/format-inspect-proxy-traps`, compat
  isolate-host.md "`util.format` / `util.inspect` of a Proxy" ⚠️.
- `formatWithOptions({ numericSeparator: true }, '%s', 1234567)` (Node `1_234_567`):
  inspect option `numericSeparator`, `runtime-js/util-surface-completions`.
- `%d %i %f %j %o %O` and a lone `'%%'`: `runtime-js/util-format-other-directives`.

## Decisions

- `builtInObjects` is a fixed list (Node v24.16.0's 47 names), not the realm's
  `globalThis`: browser/isolate realms carry other names and Node's set excludes
  `Buffer`/`URL`; the parity loop pins it against live Node.
- `colors: false`/`compact: 3` not passed: rifty's inspect has neither option (no colors,
  one layout); only the depth-0 contract is observable today.
- Proxy detection not added: a pure-JS realm cannot see one (`util.types.isProxy` throws);
  `internal/proxy-identity.ts` records identity, not target, and only where installed —
  declared ceiling above.
