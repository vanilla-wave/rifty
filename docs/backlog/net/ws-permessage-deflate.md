---
area: net
status: blocked
title: WebSocket permessage-deflate (RFC7692) — negotiate or honestly decline the client offer
created: 2026-06-18
why: full RFC7692 fidelity needs real deflate/inflate support; current bridge explicitly declines compression and compat marks it ❌ instead of silently claiming support
sources: [PR#42 ws-honesty-audit ws-client-deflate-offer-dropped-silently, RFC7692, backlog/runtime-js/zlib-web-compression-subset]
---
## Context
`server.ts acceptUpgradeOpenFrame` + `upgrade-socket.ts createWebSocketUpgradeHeaders` intentionally do not forward the client's `Sec-WebSocket-Extensions` offer into the guest `IncomingMessage`. With both ends at default config this matches npm `ws` (`WebSocketServer` defaults `perMessageDeflate: false` → negotiates nothing). When guest code enables `perMessageDeflate: true`, real Node would negotiate RFC7692 and compress; rifty cannot honestly do that while `node:zlib` is still a loud stub and no RFC7692 codec exists in `@riftydev/net`. The RSV1 guard remains a loud protocol close for stray compressed frames, and `docs/public/compat/http.md` advertises the gap as ❌.

## Options / Next
Unblock by landing either `runtime-js/zlib-web-compression-subset` with the raw deflate/inflate operations RFC7692 needs, or a zero-dependency RFC7692 codec local to `@riftydev/net`. Then forward the extension offer through the bridge, negotiate parameters, decompress RSV1 frames, compress outbound frames, and replace the compat ❌ with parity coverage. Until then the bridge declines compression; do not forward the offer without the codec, because that would negotiate an extension the frame path cannot decode.

## Reversibility
REVERSIBLE — additive negotiation; the compat ❌ + backlog record is the immediate honesty fix.
