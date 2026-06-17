---
area: net
status: parked
title: WS upgrade socket has no maxPayload cap (ws default 100MiB + close 1009)
created: 2026-06-17
why: parserFrame accepts any payload up to Number.isSafeInteger; real ws enforces a default maxPayload (104857600) and closes 1009 — a parity gap, low risk only because the bridge writer is trusted same-origin
user_story: As a rifty maintainer claiming real-ws parity, I want the RFC6455 frame parser to reject an oversized frame with close 1009 like real ws — can't yet, parseFrame (upgrade-socket.ts:~695) has no cap and the read buffers grow via Buffer.concat with no ceiling.
sources: [PR#42 review correctness/unbounded-frame-buffer-no-payload-cap, ADR-0151]
---
## Context
`packages/net/src/http/upgrade-socket.ts` `parseFrame` accepts a 64-bit length up to `Number.isSafeInteger` with no configurable `maxPayload`; `consumeServerFrameBytes`/`consumeClientFrameBytes`/`consumeHandshakeBytes` accumulate via `Buffer.concat` with no ceiling. Real `ws` defaults `maxPayload=104857600` and errors a too-large message with close 1009. DoS surface is limited: both `write()` callers are the co-resident trusted `ws` library in the same origin, not an untrusted network peer — so an oversized frame is not normally reachable.

## Options / Next
Add a `maxPayload` guard in `parseFrame` returning a protocol-error carrying close code 1009 ("Max payload size exceeded") matching the ws default; optionally cap the accumulation buffers. Needs a failing regression test first (construct an exported `WebSocketUpgradeSocket`, drive it to `accepted`, feed an oversized 127-length frame header, assert bridge close 1009).

## Reversibility
REVERSIBLE — a defensive cap + close code, no public API or wire-contract change.
