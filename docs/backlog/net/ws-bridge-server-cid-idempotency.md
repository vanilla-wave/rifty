---
area: net
status: active
title: BridgedWebSocketServer should guard duplicate 'open' frames per cid (idempotency)
created: 2026-06-18
why: a duplicate open frame for an existing cid spawns a phantom second connection and strands the first, where the sibling in-process server re-acks and returns the existing connection
sources: [PR#42 ws-honesty-audit WSB-3]
---
## Context
`bridge.ts BridgedWebSocketServer.onMessage` handles `type:'open'` unconditionally: `new BridgedWebSocketConnection`, `clients.set(cid, …)`, emit `'connection'` — overwriting any existing entry for that cid. The sibling `WebSocketServer._acceptBridge` (in-process.ts) guards this: on a known cid it re-sends `open-ack` and returns the existing connection. A real ws-server fires `'connection'` exactly once per client. A duplicate open (retry/echo) here produces a phantom second connection; the first is stranded. Not a live regression (the opt-in facade has no current duplicate-open source), but a latent divergence from the in-process sibling.

## Options / Next
Mirror `_acceptBridge`'s per-cid guard in `BridgedWebSocketServer.onMessage`: on a known cid, re-ack and return the existing connection instead of creating a new one. RED test: two open frames with the same cid → one `'connection'`.

## Reversibility
REVERSIBLE — additive guard + test.
