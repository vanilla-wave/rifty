---
area: opencode
status: active
title: v3 SSE frame bump (PREVIEW_PORT_FRAME_VERSION 2→3) for in-Worker streaming
created: 2026-06-08
why: page↔Worker SSE hangs (reassembles on reply-stream-end, never fires for SSE); needs a superseding ADR that contradicts ADR-0048 D2 + amends ADR-0017
sources: [docs/backlog/opencode/reference/README.md §deferred / §v3, decisions.md ADR-0060 draft, feature-07-ws-sse-bridge.md D2 + T5-T7, ADR-0048, ADR-0017, ADR-0040, ADR-0046, Q-2026-05-30-113, audit-digest]
---
## Context
opencode `/event` is SSE = streaming HTTP GET, not a WebSocket (ratified ADR-0055, no ws shim). SW→page hop ALREADY streams (zero-copy ReadableStream transfer; `ServerResponse.toResponse()` resolves at flushHeaders) → page-direct SSE ships with no code. The page↔Worker hop does NOT stream: `bridgeCrossRealmPreview` accumulates `reply-stream-chunk` and resolves only on `reply-stream-end`, which never fires for SSE → opencode-in-Worker HANGS + trips the 30s no-progress idle timer. Fix = bump `PREVIEW_PORT_FRAME_VERSION` 2→3 (preview-port.ts:49): page builds the Response from a live ReadableStream resolving on `reply-stream-start`, idle timer re-armed per chunk (tolerating SSE keep-alive `:\n`), worker-death mid-stream errors the handed-out stream; v2 buffered fallback under negotiation. Specified with failing tests (feature-07 T5-T7) that must NOT be committed pre-ratification.
## Options / Next
(A) v3 bump (recommended, DEFERRED). (B) keep v2, document Worker SSE as buffered — recommended SHIP order, defer the bump until `WorkerOwnerBinding` (Q-2026-05-27-002/ADR-0046) actually owns opencode. (C) dedicated MessagePort backpressure (M12/ADR-0017 endgame, far larger). Gate: Worker becomes the actual opencode owner AND a superseding ADR cites+supersedes ADR-0048 D2 ("page memory unchanged until M12") and amends ADR-0017's "SSE hangs until M12" line, confirming v3 stays on the BroadcastChannel carrier. Highest blast radius: the idle-timer re-spec can reap live event streams if wrong. Q-2026-05-30-113 (chunk-vs-event boundary): keep byte-faithful MAX_CHUNK_BYTES splitting; consumer must not treat a 64KiB chunk boundary as an SSE event boundary.
## Reversibility
IRREVERSIBLE: non-additive bump of a versioned wire contract that CONTRADICTS an already-recorded decision (ADR-0048 D2) and amends ADR-0017 → requires a DECISION SUBAGENT producing the superseding ADR (reconsidering a recorded decision — CLAUDE.md), not an inline call. Do not code/ship until ratified.
