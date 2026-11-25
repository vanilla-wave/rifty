---
area: runtime-js
status: draft
title: util.format('%s') and util.inspect run a Proxy's traps where Node reads its target, and a throwing trap throws
created: 2026-11-24
why: Node's `%s` and inspect see a Proxy's target without running a trap (`getProxyDetails`); rifty runs them — a side-effect trap runs, a Proxy over a Map throws, a revoked Proxy throws where Node prints `<Revoked Proxy>`, and since PR #449 a trap throwing on the `toString`/`Symbol.toPrimitive` read throws where Node and rifty before printed — on every host.
sources: ["probe 2026-11-24, unit runtime-js/util-format-percent-s", docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/internal/proxy-identity.ts]
---

## Context

Probe 2026-11-24/25, live `node -e` v24.16.0 vs rifty parity-runner (in-process) and isolate
`runCode`, handler logging `get`/`getOwnPropertyDescriptor`/`getPrototypeOf`/`ownKeys`:

- `util.format('%s', new Proxy({ a: 1 }, h))` → both `{ a: 1 }`; Node runs no trap, rifty
  `get, gOPD, get, gpo ×8, ownKeys, gOPD ×2, gpo, gOPD` (the `%s` dispatch, then rifty's
  inspect; external review of PR #449).
- `new Proxy({ toString() { return 'x' } }, h)` → both `x`; Node traps only `String()`'s two `get`s.
- A trap that throws on the `toString`/`Symbol.toPrimitive` read (`get`) or own check
  (`getOwnPropertyDescriptor`): `new Proxy({ a: 1 }, { get(t, k, r) { if (k === 'toString')
  throw Error('GET'); return Reflect.get(t, k, r) } })` → Node `{ a: 1 }` (and
  `validateHeaderName` its `ERR_INVALID_HTTP_TOKEN … ["{ a: 1 }"]`); rifty before PR #449
  `{ a: 1 }` too; since PR #449 (`%s` reads `toString` as Node's `hasBuiltInToString`, through
  the Proxy) `Error: GET`. A behaviour change of that PR, declared: pinned
  `tests/conformance/builtins/util-format-percent-s-declared.test.ts`, isolate corpus
  `util-format-percent-s-throwing-trap` (ceiling). A `getPrototypeOf` trap that throws
  threw before PR #449 too (inspect).
- A walk ending at a Proxy over a null-prototype object
  (`Object.create(new Proxy(Object.create(null), { get: () => () => 1 }))`): Node throws
  `TypeError: Cannot convert undefined or null to object`, rifty prints `{}` (before and
  after PR #449; pinned in the same conformance file).
- Not transparent even with a `{}` handler: `new Proxy(new Map([[1, 2]]), {})` → Node
  `Map(1) { 1 => 2 }`, rifty `TypeError: Method Map.prototype.entries called on incompatible
  receiver` (on main too). A `{}`-handler Proxy of a plain object or array prints as Node
  (parity `util/format-percent-s`).
- A revoked Proxy → Node `<Revoked Proxy>`, rifty `TypeError: Cannot perform 'get' on a proxy
  that has been revoked`.

Mechanism gap: rifty cannot reach a Proxy's target. `internal/proxy-identity.ts` wraps
`globalThis.Proxy` but records identity only (no target) and is installed only where a host
calls `proxyIdentity()` (vm, fetch platform). Same root as `runtime-js/fatal-report-proxy-traps`.
Class-kill route (not taken): a recorder that also stores the target (and revoked state),
installed on every host before guest code, read by one `getProxyDetails` in `%s` and inspect
as Node's — closes this item and the fatal-report one together.

## Challenge

challenge: 2026-11-24 — finding capture; no premise critic (README §Challenge)
