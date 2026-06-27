---
area: net
status: draft
title: server.address() full {address, family, port} shape
created: 2026-06-21
why: rifty's http/net server.address() returns only { port }; real Node returns { address, family, port }, so AddressInfo-reading code (logging, "listening on http://host:port", family branching) sees undefined address/family.
user_story: As a server author logging `const { address, family, port } = server.address()`, I want the Node-shaped AddressInfo, but today rifty returns only `{ port }` so `address`/`family` are `undefined`.
sources: [adversarial review 2026-06-21, surfaced alongside net/listen-zero-ephemeral-ports]
code: [packages/net/src/http/server.ts, packages/net/src/net.ts]
---

## Context

`HttpServer.address()` (`http/server.ts`) and `net.Server.address()` (`net.ts`)
return `{ port } | null`. Real Node returns `{ address, family, port } | null`
(an `AddressInfo`). For a default-host `listen(0)` Node reports
`{ address: '::', family: 'IPv6', port: N }`. This pre-dates
`net/listen-zero-ephemeral-ports` (that item only required `address().port`) and
is orthogonal to ephemeral allocation — but it is a real Node divergence any
AddressInfo consumer notices.

The `address`/`family` VALUES are a judgment call, not a mechanical add: rifty is
loopback-only and IGNORES host (see `request.ts`), and already DELIBERATELY
reports `127.0.0.1` for `EADDRINUSE` instead of Node's default `::` (see
`registry.addrInUseError`). So `address()` must choose ONE consistent model —
either mirror Node's default-host `::`/`IPv6`, or report the rifty loopback
`127.0.0.1`/`IPv4` to match the existing EADDRINUSE divergence. The two server
surfaces must agree.

## Options or Next

- Decide the reported `address`/`family`: (a) Node-faithful default-host
  `'::'` / `'IPv6'`; or (b) rifty-consistent `'127.0.0.1'` / `'IPv4'` matching
  the existing loopback-only `EADDRINUSE` divergence. Prefer (b) for internal
  consistency unless a real package branches on `family`.
- Widen both `address()` return types to `{ address: string; family: string; port: number } | null`, update the existing `server.test.ts` `toEqual({ port })` assertion, and add parity/conformance coverage.
- Update the HTTP compat matrix row.

## Reversibility

REVERSIBLE — recorded in this backlog item. Additive shape over the existing
`{ port }` return; the address/family value choice is a behavior-preserving
judgment call (no public API removal, no ADR).
