# ADR 0055: opencode event stream rides SSE-over-streaming-HTTP; no `ws` shim (page-direct deployment)

Status: Accepted (ratifies decisions.md draft ADR-0059; opencode facade M12)
Date: 2026-05-30

> TL;DR: opencode `/event` SSE rides the existing page-direct streaming-HTTP `Response` (live `ReadableStream`) with no `ws` shim; supported page-direct only

## Context

opencode's `/event` route is `text/event-stream` over HTTP GET (Effect `HttpServerResponse.stream`), NOT a WebSocket. The only WS-shaped route is PTY-connect, a hard browser blocker that stays a throw-on-connect stub. Question: does the event stream need a cross-realm `ws` shim, or does it ride the existing streaming-HTTP path?

**Spike D (gate) passed** (read-only against working tree):
- `ServerResponse.toResponse()` (`packages/net/src/http/response.ts:224`) returns a promise resolved inside `flushHeaders()` (lines 137-143) via `new Response(this.body, …)`, where `this.body` is a live `ReadableStream<Uint8Array>`. It resolves at header-flush — on first `write()`/`end()`, BEFORE the stream completes (`response.test.ts:13-63` drains chunks incrementally before `end()`). An SSE response never calls `end()`, so the page-direct stream stays open and streams incrementally — SW→page page-direct needs NO new transport code.
- The page↔Worker bridge is at `PREVIEW_PORT_FRAME_VERSION = '2'` (`preview-port.ts:49`); its page side resolves a Response only on `reply-stream-end` (lines 392-415), which SSE never sends — so a Worker-owned SSE stream cannot deliver under v2. Spike D sharpened the failure mode: for a LIVE stream the no-progress idle timer is re-armed on every chunk (`preview-port.ts:376/389`), so the dominant failure is an INDEFINITE HANG, not the 30s timeout the draft implied. (Concerns the SEPARATE, deferred v3 bump, not this ADR.)

## Decision

- **D1 — SSE = streaming HTTP `Response` over the existing bridge (option A).** The `/event` route is served as a streaming `Response` (live `ReadableStream` body) over the existing SW→page page-direct path. NO `ws` shim for `/event`.
- **D2 — Rules OUT a `ws` shim for the event route.** Existing `BridgedWebSocket` (`packages/net/src/ws/bridge.ts`) is HMR-only / same-origin BroadcastChannel, left untouched; opencode never serves events over WS, so a shim is pure impedance mismatch, new surface, no benefit (option B rejected). Buffering the SSE response (option C) rejected — degrades the streaming event API.
- **D3 — Scope: page-direct only.** "Supported" is scoped to the page-direct (`FirstWindowOwnerBinding`) deployment. The Worker deployment buffers/hangs on an SSE body until ADR-0060 (deferred v3 bump) ships. NOT a token-streaming-to-browser-in-all-deployments claim (review M3).
- **D4 — Documented compat ceiling.** A no-transferable-stream realm falls back to the drain path (`body-transport.ts:68`) and would hang on an unending SSE body — recorded as the compat ceiling so the gated compat-matrix entry is honest.

## Consequences

- PTY-connect (only WS-shaped route) stays a throw-on-connect stub. SSE keep-alive/reconnect rides the streaming HTTP path. The feature-05 negative test (commit faaaf8f) locks that an upgrade is not silently consumed into the buffered HTTP path.
- Page-direct needs NO new code, but this ADR is the merge gate for any compat-matrix "supported" claim for the event stream and for the zero-code page-direct ship.
- Stays WITHIN ADR-0048 D2's "page memory unchanged until M12" clause: page-direct rides the SW→page hop ADR-0048 already streams. Only the SEPARATE draft ADR-0060 (page↔Worker v3 bump) touches that clause — and it is DEFERRED.
- Contract locked by rifty-only unit/conformance tests on `ServerResponse`/`body-transport`/`route-preview` (feature-07 T2/T3/T4); only the opencode parity proof (T1) and the Worker-streaming v3 path (ADR-0060) need the vendored tree, neither in scope.

## Reversibility

IRREVERSIBLE (reversibility rule 1 — pins a cross-package contract; bounds ADR-0048's streaming scope). A NEGATIVE architectural commitment (do not build a `ws` shim; pin SSE = streaming-HTTP) over a page-direct path that already streams in code — reverting is cheap. Ratified because Spike D verified page-direct streams with zero new code and the WS route genuinely does not exist in opencode. ADRs are immutable after merge.

## Risks / follow-ups

- The `/event` parity proof (feature-07 T1) needs the vendored tree and is NOT a precondition for this principle.
- Worker-owned SSE (incremental streaming over the page↔Worker bridge) requires the v3 frame bump, DEFERRED (decisions.md draft ADR-0060): it bumps a versioned wire contract, contradicts ADR-0048 D2 / ADR-0017's M12 deferral, and is gated on the Worker actually being the opencode owner (ADR-0046). Do NOT ship v3 under this ratification.
- SSE byte-vs-event boundary on the page↔Worker transport is a consumer-contract note (Q-2026-05-30-113), not part of this page-direct ADR.

## References

- ADR-0017 (net streaming deferral); ADR-0040 (SW frame/routing); ADR-0046 (PreviewOwnerBinding); ADR-0048 (streaming cross-realm preview frame — the "page memory unchanged until M12" clause this stays within).
- decisions.md draft ADR-0059; feature-07-ws-sse-bridge.md (T1-T4).
- Spike D result (page-direct streams; v2 Worker path hangs, 2026-05-30).
