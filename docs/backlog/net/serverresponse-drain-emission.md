---
area: net
status: active
title: ServerResponse Node-style 'drain' emission (gated by _needDrain) — confirm and promote
created: 2026-06-08
why: Shipped Node-parity widening still carries a TODO(backlog: net/serverresponse-drain-emission) marker; needs confirm→promote, not new work
user_story: As a developer streaming a large response via `res.on('drain')` after a backpressured `write()`, I want the `'drain'` event to fire like Node, but the gated emission ships under a `TODO(backlog)` marker awaiting confirm→promote — not yet ratified as guaranteed.
sources: [Q-2026-05-30-102, feature-05-effect-http-bridge T3, ADR-0054]
code: [packages/net/src/http/response.ts:51, packages/net/src/http/response.ts:74]
---
## Context
Effect's streaming write loop (`internal/httpServer.ts`) parks on `res.on('drain')` and ignores `write()`'s return; rifty `ServerResponse` signalled backpressure ONLY via `write()`'s `boolean|Promise<boolean>` return and never emitted Node `'drain'` → Effect-driven streaming hangs forever. Fix: emit `'drain'` inside the `ReadableStream` `pull()` callback after draining `pendingPulls`, gated by a `_needDrain` flag set only when `write()` returned the backpressure Promise (no spurious pre-backpressure drain). Shipped + tested, additive. Markers live at response.ts:51 (`_needDrain` field) and :74 (pull emit site).

## Options / Next
Decision taken (Q-102 Option A): emit gated `'drain'`, keep `write()`'s return unchanged. Rejected: (a) shadow-registry patch of Effect to await `write()` Promise (couples to Effect beta internals); (b) buffer whole response (defeats P4 LLM streaming). Next: confirm at M12 DoD → promote to ADR via `pnpm adr:new net` (manual), re-anchor both `TODO(backlog: net/serverresponse-drain-emission)` markers. Implemented + Node-faithful, awaiting promotion only.

## Reversibility
REVERSIBLE (checklist rule 4: single file, additive, <30 lines, no new export/dep, no ADR conflict). The backlog item is this file (Q-2026-05-30-102); confirm→promote.
