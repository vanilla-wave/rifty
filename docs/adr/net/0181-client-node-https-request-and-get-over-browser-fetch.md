# ADR 0181: Client `node:https` request/get over browser fetch

Status: Accepted
Date: 2026-06

> TL;DR: `https.request`/`https.get` for non-loopback targets route through the same host `fetch()` egress `node:http` already uses for external `https:` URLs (the page does TLS); `createServer`, `Agent`, and every TLS/socket option keep throwing `NotImplementedError`. Narrows ADR-0010's "every method throws" clause; the TLS-server/socket ceiling stands.

## Context

ADR-0010 registered `node:https` as a loud-throw stub — correctly killing the old `https→http` alias that silently stripped TLS semantics — but threw on EVERY method, including `request`/`get`, and declared a terminal state. That over-reaches the browser ceiling: a plain `https.get('https://api.example.com')` needs no in-realm TLS — the browser's `fetch()` already performs (validated) TLS, exactly as `node:http` relies on for external `https:` URLs (`routeClientRequest` → `{ kind: 'fetch' }` → `fetch(url, init)` → `IncomingMessageFromFetch`, `packages/net/src/http/server.ts`). The missing piece is a client-only subset, not a return to fake TLS.

## Decision

### D1 — Client request/get route over fetch

`https.request(url|opts, opts?, cb?)` and `https.get(...)` reuse the `node:http` client machinery (URL/options/body/header handling, `ClientRequest` return, `'response'`/`IncomingMessage` events, streaming + backpressure) with `protocol: 'https:'` forced, taking the host `fetch()` egress for non-loopback targets. A loopback `https:` target has no server (D3) and throws.

### D2 — `globalAgent` is a benign config object

`https.globalAgent` and the `https.Agent` *type surface* are exposed as a plain object whose CONFIG fields are readable (libs do `if (https.globalAgent) …`, `agent.maxSockets`) without throwing — but it controls no real socket pool. Constructing a custom agent (`new https.Agent(opts)`) still throws (D3): there is no socket layer to configure.

### D3 — TLS/server/socket surface keeps throwing (ADR-0010 ceiling stands)

`https.createServer`, `new https.Agent()`, and any request passed a TLS/socket-control option — `cert`, `key`, `ca`, `pfx`, `passphrase`, `ciphers`, `secureProtocol`, `servername`, `rejectUnauthorized`, a custom `agent` instance — throw `NotImplementedError('node:https.<feature>')`. Fidelity: the browser does TLS with validation; "skip cert validation" / a custom socket pool cannot be honored, so it is refused loudly, never silently ignored.

## Consequences

- Client packages importing `node:https` for `request`/`get` over a normal `https:` URL work (e.g. `node-fetch`/`axios` node adapters on https targets, direct `https.get`); the path is byte-identical to the proven `node:http`-external-https route.
- The TLS server/socket ceiling is unchanged from ADR-0010 — still loud `NotImplementedError` + compat ❌, never a plaintext fallback.
- ADR-0010 stays active; only its "every method throws / terminal state" clause is corrected (see `docs/adr/README.md` Corrections + the dated note in ADR-0010). Active ADRs 0153/0159 that cite ADR-0010 keep resolving.

## References

- ADR-0010 (`node:https` loud-throw stub — corrected clause), ADR-0017 (net scope), ADR-0054 (additive http shape-widening precedent).
- `packages/net/src/https.ts`, `packages/net/src/http/server.ts` (`routeClientRequest`, fetch egress), `packages/net/src/http/request.ts` (`IncomingMessageFromFetch`), `packages/net/src/register-builtins.ts`.
