---
area: net
status: active
title: WebSocket permessage-deflate (RFC7692) — negotiate or honestly decline the client offer
created: 2026-06-18
why: a client `Sec-WebSocket-Extensions: permessage-deflate` offer is silently stripped at the bridge upgrade boundary, never reaching the guest ws-server — divergent only when the guest enables compression, but undocumented
sources: [PR#42 ws-honesty-audit ws-client-deflate-offer-dropped-silently, RFC7692]
---
## Context
`server.ts acceptUpgradeOpenFrame` + `upgrade-socket.ts createWebSocketUpgradeHeaders` build the guest `IncomingMessage` headers without forwarding the client's `Sec-WebSocket-Extensions`; the bridge `open` frame does not carry it. With BOTH ends at default config this is byte-for-byte faithful (npm `ws` server defaults `perMessageDeflate: false` → negotiates nothing). It diverges only when the guest server sets `perMessageDeflate: true`: real Node compresses, rifty silently does not. The RSV1 guard in the frame parser is a loud backstop against stray compressed frames. There is currently NO mention of permessage-deflate in net source/CHANGELOG/ADR/compat — so the gap is silent-absence, not yet honest.

## Options / Next
Either (a) forward the client extensions offer through the bridge and implement RFC7692 deflate, or (b) explicitly decline and document it. Minimum honest step: a compat ❌ row for permessage-deflate + this backlog. Full fidelity needs the deflate/inflate codec + negotiation.

## Reversibility
REVERSIBLE — additive negotiation; the compat ❌ + backlog record is the immediate honesty fix.
