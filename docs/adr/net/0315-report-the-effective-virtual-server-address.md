# ADR 0315: Report the effective virtual server address

Status: Accepted
Date: 2026-07

> TL;DR: `http.Server.address()` and `net.Server.address()` report the
> port-only registry's effective `127.0.0.1` / `IPv4` endpoint.

## Context

Both server implementations returned `{ port }`. Node v24 returns
`{ address, family, port }`; Vite 7 and 8 reject the truncated shape when
building their printed URL lists, so a listening server publishes its port but
never prints `Local:`.

ADR-0054 deliberately made `listen(..., host)` a loopback-only, port-keyed
operation: the registry neither binds nor resolves the requested host. Echoing
that ignored input from `address()` would claim a bind that did not happen.

## Decision

- One in-package shaper owns the `AddressInfo` returned by both server classes.
- A registered server reports
  `{ address: '127.0.0.1', family: 'IPv4', port }`, the effective virtual
  endpoint. Explicit `127.0.0.1` matches Node v24 exactly.
- `address()` returns `null` before registration, while an explicit-port claim
  is pending or lost, and after close.
- This does not add host-sensitive bind or DNS semantics. Requested default,
  IPv6, wildcard, and hostname values remain ignored under ADR-0054 and
  therefore do not alter the reported endpoint.

## Consequences

- AddressInfo-reading packages, including Vite's URL printer, see a complete
  honest endpoint instead of missing fields.
- Node's default `::` / `IPv6` and explicit non-IPv4 address reports remain a
  documented browser-model divergence; the registry does not pretend to honor
  those binds.
- Real host-sensitive bind support would supersede this decision and ADR-0054;
  it cannot be implemented by merely preserving the requested string.
