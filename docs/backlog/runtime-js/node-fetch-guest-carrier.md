---
area: runtime-js
status: draft
title: Prove guest Fetch classes with a real Hono and body-lifetime carrier
created: 2026-10-20
why: Native browser classes lose Node headers and body lifetime; executable acceptance must expose each wall before replacement.
epic: node-fetch-classes-in-guest
---

## Context

Goal scenario is the authority. One program runs unchanged in real Node and
the actual rifty child worker; no in-process Node-versus-Node oracle.

## Challenge

challenge: 2026-10-20 — clear

Reuse goal premise and user's explicit browser-transport choice.

## Acceptance

1. Real Hono request with Cookie and File multipart prints Node's result; header conversion matches Node. → I1
2. bodyUsed/locking, clones, copied Request and stream consumption match the live Node oracle; detached body reads complete, stalled guest work exits. → I2
3. Real HTTP multipart echo and fetched-response clone/reader cases match Node; unsupported Cookie dispatch rejects explicitly; abort/network errors do not leak a process hold. → I3

## Reference contract

- Oracle: Node 24.16.0, bundled undici 7.25.0; Chromium worker is the subject.
- Same CommonJS source in both runtimes; generated multipart boundaries normalized only by parsing them, never byte goldens.

## Parity cases

1. Hono app.request POST with Cookie and File; Headers getSetCookie, forbidden request header retention, constructor identities. → I1
2. Response clone and both tee branches; multipart Request direct read; guest-stream response text; never-resolving source; consumed/locked bodies and Request copies. → I2
3. POST multipart; fetched body reader lock and clone; response URL/status/type/headers; abort and connection failure. → I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| abort × fetch/body | rejects; hold released | network carrier abort | I3 |
| source error × body consumer | rejects; cannot reread | body error case | I2 |
| unavailable transport × fetch | rejects; process exits | connection failure | I3 |
| forbidden wire header × fetch | named unsupported error | Cookie case | I3 |

## Out of scope

Server transport; WebSocket/EventSource; WebAssembly streaming remains its
existing NotImplementedError ceiling.

## Decisions

- 2026-10-20 — carrier first, expected failures until the owner is replaced; same PR throughout.
