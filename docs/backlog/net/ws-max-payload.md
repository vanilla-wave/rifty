---
area: net
status: blocked
title: WebSocket upgrade transcoder caps a frame at a fixed 100 MiB; guest ws maxPayload above the default is not honored
created: 2026-06-18
why: the bridge upgrade transcoder enforces a fixed 100 MiB reassembly cap (the ws default); a guest ws server/client maxPayload set ABOVE 100 MiB is silently capped by the transport, and the transport bound is not separately configurable
sources: [PR#42 ws-honesty-audit ws-fragment-accumulation-unbounded, PR#53 review max-payload-not-configurable, RFC6455 §7.4.1 (1009)]
---
## Context
`upgrade-socket.ts` parseFrame + handleServer/ClientContinuation bound a single frame AND cumulative fragmented reassembly against `maxPayload` (default `DEFAULT_MAX_PAYLOAD` = 100 MiB; `0` = unlimited, matching ws) and close 1009 past it — this closes the original unbounded-accumulation gap with RED tests. But the upgrade sockets are always constructed without a `maxPayload` (`server.ts` upgrade-accept + client-upgrade paths), so the transport bound is fixed at 100 MiB. A guest's real `ws` server/client `maxPayload` is enforced by the `ws` Receiver itself on inbound frames; below 100 MiB it closes 1009 on its own, so behavior matches Node. The residual divergence is narrow: a guest raising `maxPayload` ABOVE 100 MiB still gets capped at 100 MiB by the rifty transcoder, and the transport bound cannot be configured independently.

## Options / Next
Thread a configurable bound from the http upgrade path into `WebSocketUpgradeSocket`/`WebSocketClientSocket`. Faithfully tracking a guest `ws` server's `maxPayload` needs the rifty loader to observe the npm `ws` `WebSocketServer`/`WebSocket` options at upgrade time (no current hook) — blocked on that integration. Until then the fixed 100 MiB transport cap is documented in `compat/http.md`. The socket option + `0`-means-unlimited path are already covered in `upgrade-socket.test.ts`; what's missing is wiring a guest value through.

## Reversibility
REVERSIBLE — additive configurable bound + ws-lib option observation.
