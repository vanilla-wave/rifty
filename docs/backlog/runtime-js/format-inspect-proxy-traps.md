---
area: runtime-js
status: draft
title: util.format('%s') and util.inspect run a Proxy's traps where Node reads its target
created: 2026-11-24
why: Node's `%s` and inspect see a Proxy's target without running a trap (`getProxyDetails`); rifty runs them, so a trap with side effects or a lying trap prints/acts differently, and a revoked Proxy throws where Node prints `<Revoked Proxy>` — on every host.
sources: ["probe 2026-11-24, unit runtime-js/util-format-percent-s", docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/internal/proxy-identity.ts]
---

## Context

Probe 2026-11-24, live `node -e` v24.16.0 vs rifty parity-runner (in-process), handler
logging `get`/`getOwnPropertyDescriptor`/`getPrototypeOf`:
`util.format('%s', new Proxy({ a: 1 }, h))` → both `{ a: 1 }`; Node runs no trap, rifty
`get toString, gopd toString, get Symbol.toPrimitive, gpo ×8, gopd a, gopd constructor, …`
(the `%s` dispatch, then rifty's inspect). `new Proxy({ toString() { return 'x' } }, h)` →
both `x`; Node traps only `String()`'s two `get`s. A revoked Proxy → Node `<Revoked Proxy>`,
rifty `TypeError: Cannot perform 'get' on a proxy that has been revoked`. Transparent
proxies (`{}` handler) print as Node (parity `util/format-percent-s`).

A pure-JS realm cannot tell a Proxy from its target (`util.types.isProxy` throws).
`internal/proxy-identity.ts` records identity (not target) where installed (vm, fetch
platform). Neighbour: `runtime-js/fatal-report-proxy-traps` (same mechanism question in
the fatal report).

## Challenge

challenge: 2026-11-24 — finding capture; no premise critic (README §Challenge)
