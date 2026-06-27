---
area: net
status: draft
title: Client-only node:https request/get subset over browser fetch
created: 2026-06-19
why: ADR-0010 makes the whole node:https surface a loud stub, but client request/get can be a faithful fetch-backed subset without promising TLS sockets or https.createServer
user_story: As a developer running an HTTP-client package that imports `node:https` for `https.request()` or `https.get()`, I want client requests to work over the browser's already-TLS-protected fetch path, but today every `node:https` call throws `NotImplementedError` even when no TLS socket controls are used.
sources: [ADR-0010, docs/public/compat/http.md, "subagent audit 2026-06-19"]
code: [packages/net/src/https.ts, packages/net/src/http/server.ts, packages/net/src/http/client.test.ts]
---

## Context

ADR-0010 correctly stopped aliasing `node:https` to `node:http`; pretending to
own TLS inside the browser was a silent-stub bug. The current result is broader
than the browser ceiling, though: `https.request()` and `https.get()` for normal
client fetches can route through the same host `fetch()` path that `node:http`
already uses for external `https:` URLs. That does not expose a TLS socket,
certificate controls, custom agents, ALPN, or server-side TLS termination.

The missing item is a narrow client-only subset, not a reversal to fake TLS.
`https.createServer`, `Agent`, `globalAgent` socket controls, custom cert/key
options, and low-level TLS knobs must keep throwing directed
`NotImplementedError`s unless a later ADR explicitly expands scope.

## Options or Next

- Supersede or amend ADR-0010 before implementation, because it currently says
  every `node:https` call throws and has no follow-up milestone.
- Reuse the `node:http` request/get client machinery for URL/options/body/header
  behaviour, forcing `protocol: 'https:'` and host `fetch()` egress for non-local
  targets.
- Reject TLS/socket-specific options loudly instead of ignoring them.
- Add parity/ceiling tests first: normal `https.get('https://...')` shape,
  callback/event/body semantics, and throws for `createServer`/`Agent`/cert
  options.
- Update `docs/public/compat/http.md` to distinguish client request/get subset
  from TLS server/socket ceilings.

## Reversibility

Implementation is IRREVERSIBLE until recorded, because it supersedes ADR-0010's
current public contract that every `node:https` method throws. The backlog item
itself is REVERSIBLE; the implementation needs an ADR or superseding ADR first.
