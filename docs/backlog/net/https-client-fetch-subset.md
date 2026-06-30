---
area: net
status: ready
title: Client-only node:https request/get subset over browser fetch
created: 2026-06-19
why: ADR-0010 makes the whole node:https surface a loud stub, but client request/get can be a faithful fetch-backed subset without promising TLS sockets or https.createServer
user_story: As a developer running an HTTP-client package that imports `node:https` for `https.request()` or `https.get()` (e.g. node-fetch / axios node adapters on an `https:` URL, or a direct `https.get('https://api.github.com/...')`), I want client requests to work over the browser's already-TLS-protected fetch path, but today every `node:https` call throws `NotImplementedError` even when no TLS socket controls are used.
sources: [ADR-0181, ADR-0010, docs/public/compat/http.md]
code: [packages/net/src/https.ts, packages/net/src/http/server.ts, packages/net/src/http/request.ts, packages/net/src/register-builtins.ts]
---

## Context

ADR-0010 correctly stopped aliasing `node:https` to `node:http` (the alias silently stripped TLS), but threw on EVERY method — over-reaching the browser ceiling. `https.request`/`https.get` over a normal `https:` URL need no in-realm TLS: the browser's `fetch()` already does (validated) TLS, exactly as `node:http` relies on for external `https:` URLs (`routeClientRequest` → `{ kind: 'fetch' }` → `fetch` → `IncomingMessageFromFetch`). The missing item is a narrow client-only subset, not a reversal to fake TLS. ADR-0181 records the decision and corrects ADR-0010's "every method throws / terminal state" clause in place (the TLS-server/socket ceiling stays).

## User scenario

A developer runs a script/CLI that fetches over HTTPS through `node:https` — either a direct `https.get('https://api.github.com/repos/x/y', res => { res.on('data', …); res.on('end', …) })`, or a library that uses `node:https` under the hood for `https:` URLs (e.g. `node-fetch` / the `axios` node adapter against `https://…`). Today the import resolves but the call throws `NotImplementedError('node:https.get', 'TLS termination is not available …')`. After this item the request egresses over the browser's TLS-validated `fetch`, the callback gets a real `IncomingMessage` (`statusCode`/`headers`/`'data'`/`'end'`); meanwhile `https.createServer(...)` or `new https.Agent({ cert })` still throws loudly.

## Acceptance

- `https.get('https://<external>')` and `https.request({hostname, path, method, headers}, cb)` to an external `https:` URL return an `IncomingMessage` (`statusCode`/`statusMessage`/`headers`; a Readable emitting `'data'`/`'end'`) via host `fetch()` — behaviour-identical to the proven `node:http` external-`https` route. POST body + backpressure (`'drain'`, `write()` → `false`) work. `import https from 'node:https'` still resolves.
- `https.createServer`, `new https.Agent()`, and any TLS/socket option throw `NotImplementedError('node:https.<feature>')`; `https.globalAgent` is a readable config object (no throw on property read) and `typeof https.globalAgent === 'object'`.
An implementation that silently ignores a TLS option, fake-acks a server, or throws on a benign `globalAgent` read fails this.

## Parity cases

- `https.get(url, cb)`: `cb` receives `res`; `res.statusCode`, `res.headers`, `'data'`+`'end'` fire; `res` is a Readable — matches Node's IncomingMessage shape.
- `https.request(options, cb)`: returns a `ClientRequest`; `req.end()` sends; the `'response'` event arg equals the `cb` arg; `req.write()`/`req.end(body)` for POST.
- `https.request(url, options, cb)` 3-arg merge (method/header overrides) — identical to `http.request`.
- 204 / 304 / null-body statuses → no invalid body (inherited from the http client).
- Throws: `https.createServer()` → `NotImplementedError` naming `node:https.createServer` + the TLS message; `new https.Agent()` → throws; `https.request({ ..., rejectUnauthorized: false })` → throws naming the refused option (never silently honored OR ignored).
- `https.globalAgent` config read (e.g. `.maxSockets`) does NOT throw; `if (https.globalAgent)` is truthy.

## Out of scope

- `https.createServer` / server-side TLS termination — throw + compat ❌.
- `new https.Agent(...)` custom socket pool, keep-alive pools, `maxSockets` enforcement — throw + compat ❌ (no socket layer to back them).
- TLS/cert controls passed to a request: `cert`, `key`, `ca`, `pfx`, `passphrase`, `ciphers`, `secureProtocol`, `servername`, `rejectUnauthorized`, a custom `agent` instance — throw `NotImplementedError`, never ignored.
- Loopback `https://localhost:P` — no in-browser https server; throws (pairs with ADR-0180 D4).
- ALPN, HTTP/2-over-TLS, low-level `tls`/`net` sockets — unchanged loud throw (ADR-0017).

## Decisions

- Reuse the `node:http` client machinery with `protocol: 'https:'` forced; host `fetch()` egress for non-loopback (ADR-0181 D1).
- `globalAgent` = benign config object, not a throwing proxy (ADR-0181 D2).
- TLS/socket options throw, never silently ignored (Fidelity; ADR-0181 D3).
- Contradicts ADR-0010's "every method throws / terminal state" clause → ADR-0181 (correction-in-place of ADR-0010; TLS-server/socket ceiling unchanged).
- IRREVERSIBLE (public contract change) → ADR-0181 exists.

## Reversibility

IRREVERSIBLE — changes ADR-0010's public contract for `node:https`; recorded in ADR-0181 (+ ADR-0010 correction note).
