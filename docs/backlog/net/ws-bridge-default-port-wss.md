---
area: net
status: active
title: WebSocket bridge default-port (wss:// / ws:// without explicit port) discovery desync
created: 2026-06-18
why: a default-port `wss://host/path` resolves to a synthetic :443 discovery channel while a server binds its real port, so the two never meet — a loud but undocumented 1006
sources: [PR#42 ws-honesty-audit WSB-4]
---
## Context
`browser-client-script.ts portChannelNameFor` derives the discovery port from `url.port || (wss? 443 : 80)`. A `wss://host/foo` with no explicit port keys the discovery channel on the synthetic 443, but a `WebSocketServer` binds and announces on its real numeric port → discovery channels do not intersect → the client times out to a loud 1006 "connection refused". It fails loud (not silent) and live HMR always uses explicit `ws://host:port`, so it is not a live regression — but the default-port path is untested and the synthetic-443 special-case is a latent foot-gun.

## Options / Next
Drop the `wss → 443` synthetic-port special-case; derive a single discovery key consistently for client and server (or require explicit ports). RED test: a default-port `wss://` client + a server on the matching port connect. Add a default-port wss bridge test.

## Reversibility
REVERSIBLE — discovery-key derivation + test.
