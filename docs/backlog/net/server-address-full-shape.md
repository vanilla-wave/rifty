---
area: net
status: ready
title: server.address() full {address, family, port} shape
created: 2026-06-21
why: rifty's http/net server.address() returns only { port }; Vite 7/8 rejects that truncated shape when resolving printable server URLs, so a live server can omit its Local URL.
user_story: As a developer running Vite in rifty, I want the listening CLI to print its Local URL from a Node-shaped AddressInfo, but today Vite sees `{ port }`, resolves no URL, and prints no `Local:` line.
sources: [adversarial review 2026-06-21, Node v24.16.0 parity probe 2026-07-24, Vite 7.3.6 resolveServerUrls, Vite 8.0.16 resolveServerUrls]
code: [packages/net/src/http/server.ts, packages/net/src/net.ts, packages/net/src/registry.ts, tools/node-parity-runner/cases/http]
---

## Context

`HttpServer.address()` and `net.Server.address()` return `{ port } | null`.
Node v24.16.0 returns a detached
`{ address: string, family: 'IPv4' | 'IPv6', port: number }` for an IP listener
and `null` before `'listening'` or immediately after `close()`.

Vite 7.3.6 and 8.0.16 call `server.address()`, accept it only when
`address?.address` is truthy, then use its port to build `resolvedUrls`. The
truncated rifty object therefore becomes `{ local: [], network: [] }`: the
server is live, but the CLI prints no `Local:` URL.

Rifty's registry is intentionally port-keyed and loopback-only. It neither
binds nor resolves the requested host; `HttpFramedSocket.localAddress` and
`EADDRINUSE.address` already expose its effective `127.0.0.1` endpoint.
Echoing an ignored default, IPv6, wildcard, or DNS host from `address()` would
be a provenance lie. This item completes the Node object shape while preserving
that existing host model.

## User scenario

A developer opens the Vite 7.3.6 or Vite 8.0.16 project in the Playground and
runs `npm run dev`. After the real installed Vite process reaches
`'listening'`, its unchanged `resolveServerUrls` sees a complete
`AddressInfo`; terminal output contains a `Local:` URL with the actual bound
port, and that URL corresponds to the same live preview port. No Vite-specific
branch or fabricated ready line participates.

## Acceptance

- `http.Server.address()` and `net.Server.address()` share one shaping
  chokepoint and one contract suite. While registered they return exactly own
  enumerable keys `address`, `family`, `port`; `address` is non-empty,
  `family` is the string `'IPv4'` or `'IPv6'`, and `port` is the actual integer
  registry port in `1..65535`. `{ port }` is never a successful result.
- The effective virtual endpoint is
  `{ address: '127.0.0.1', family: 'IPv4', port }` for default, IPv4, IPv6,
  wildcard, and DNS host arguments because those arguments remain ignored by
  the existing port-only bind. The HTTP compat row is `⚠️`, naming exact IPv4
  parity and the host/address-family divergence.
- Each call returns a detached object. Mutating one result cannot alter the
  next result or the server's bound state.
- Both server classes return `null` before `listen()`, synchronously after
  `listen()` but before `'listening'`, while an explicit-port cross-realm claim
  is pending, after claim loss, and immediately after `close()` and in its
  callback.
- A `kind: 'http'` differential case pins the exact Node-compatible IPv4 shape,
  key set, port range, detached-result behavior, and null lifecycle for both
  server classes. A paired IPv6 oracle/intentional-delta case records Node's
  `::1` / `'IPv6'` result and rifty's honest effective
  `127.0.0.1` / `'IPv4'` result; it may not normalize away `family`.
- The non-opt-in Vite browser contract runs real installed Vite 7.3.6 and
  8.0.16, observes a `Local:` URL after listen, and proves its port is the
  published live preview port. A source grep, mocked Vite URL resolver, or
  synthetic ready log cannot close acceptance.
- `docs/public/compat/http.md` and `packages/net/CHANGELOG.md` describe the full
  shape, lifecycle, exact IPv4 parity, and the explicit non-IPv4 divergence.

## Reference contract

- Oracle: Node v24.16.0 `node:http` and `node:net`; Vite 7.3.6 and 8.0.16
  `resolveServerUrls`.
- Mechanism: the existing node-parity-runner `kind: 'http'` executes the same
  server program against Node and rifty; the browser acceptance runs the
  installed Vite CLI unchanged.

## Parity cases

1. `http.Server` and `net.Server`, positional
   `listen(0, '127.0.0.1')`: before-listen `null`; during-listen exact
   `{ address: '127.0.0.1', family: 'IPv4', port }`; own keys
   `address,family,port`; positive in-range port; after-close `null`.
2. Both server classes, options
   `listen({ port: 0, host: '127.0.0.1' })`: same observations as case 1.
3. Node v24.16.0 explicit `::1`, positional and options forms: exact
   `{ address: '::1', family: 'IPv6', port }`. The paired rifty assertion pins
   the documented port-registry delta
   `{ address: '127.0.0.1', family: 'IPv4', port }`; reporting `::1` without an
   IPv6 bind is forbidden.
4. Node default host: `::` / `'IPv6'` when IPv6 is available, otherwise
   `0.0.0.0` / `'IPv4'`. Rifty deterministically reports its effective
   `127.0.0.1` / `'IPv4'` endpoint and the compat matrix preserves the delta.
5. Lifecycle/order: `null` before listen, after the listen call but before
   `'listening'`, during a pending/denied rifty bind claim, immediately after
   `close()`, and in the close callback. No partial object is observable.
6. Identity: two bound-state calls are structurally equal but not the same
   object; mutation of the first does not affect the second.

## Fault matrix

Boundary: `address()` reads in-realm server bind state; an explicit-port bind
is admitted through the existing BroadcastChannel claim. No new coordination
mechanism, cache, persistence, or remote network read is introduced.

| Axis × operation | Honest outcome |
|---|---|
| `provenance-lie` × requested host | report the registry's effective endpoint; never echo a host the registry did not bind |
| `observable-order` × bind/close | `null` until bind success and after loss/close; full object only for a registered port |
| `sibling-drift` × http/net | one shaper + shared suite; both classes expose identical shape and lifecycle |

## Out of scope

- Unix-domain socket / named-pipe `listen(path)` and the corresponding string
  result from `address()`:
  `NotImplementedError('net.Server.listen.path')` and
  `NotImplementedError('http.Server.listen.path')` + compat ❌.
- Existing file-descriptor, native handle, and `net.BoundSocket` listen forms:
  `NotImplementedError('net.Server.listen.handle')` and
  `NotImplementedError('http.Server.listen.handle')` + compat ❌.
- `listen({ ipv6Only: true })`:
  `NotImplementedError('net.Server.listen.ipv6Only')` and
  `NotImplementedError('http.Server.listen.ipv6Only')` + compat ❌. The accepted
  `host` field remains explicitly ignored; real host-sensitive bind, DNS,
  interface enumeration, and dual-stack occupancy require a separate
  Node-parity contract.

## Decisions

- Report the effective virtual endpoint, not the ignored host argument:
  `127.0.0.1` / `'IPv4'`. This matches explicit IPv4 Node v24 behavior and the
  existing loopback registry, socket fields, and `EADDRINUSE` provenance.
- Preserve Node's exact `AddressInfo` property names and string family values.
  Pipe listeners remain loud-unimplemented, so these server classes return
  `AddressInfo | null`, never a fake string.
- Bind state owns one complete address fact; `address()` returns a detached
  projection. No parallel `port` plus derived-address state.
- One in-package shaper serves HTTP and net. No new public adapter, Vite hook,
  wire field, storage, or coordination mechanism.
- Vite is acceptance evidence only. Production networking remains generic; the
  fix is complete for every `AddressInfo` consumer.
- Real host/address-family binding would supersede the existing port-only model
  and is not approximated by preserving the requested string.
