# Feature 07-ws-sse-bridge — ws-over-SW bridge for the SSE/event stream route

> Part of the opencode-in-rifty facade effort. Feasibility phase P4. Staged doc — NOT a ratified ADR.

## Summary

opencode's event-stream route (`/event`) is server-sent events: a long-lived HTTP GET whose body is a `text/event-stream` `ReadableStream` produced by Effect's `HttpServerResponse.stream`. It is NOT a WebSocket — the only WebSocket-shaped surface on opencode is the PTY-connect route, which stays a hard-blocked stub. So the correct transport for THIS feature is "SSE = streaming HTTP response", NOT a `ws` shim. That collapses most of the apparent risk: an SSE response is just a `Response` whose body never ends until the client disconnects.

Two hops carry that body in rifty, and they differ sharply:

1. **SW→page hop** (`packages/service-worker/src/route-preview.ts:131`, `body-transport.ts:55`): ALREADY streams. `packSerializedResponse` transfers a `ReadableStream` zero-copy when the realm supports transferable streams (Chromium ≥89, FF ≥103, Safari ≥16.4), and `routePreview` reconstructs `new Response(raw, …)` directly from the transferred stream. The page-side handler is opencode's `webHandler()` returning rifty `ServerResponse` (response.ts), whose `toResponse()` resolves a `Response` backed by a live `ReadableStream` the moment `flushHeaders()` runs (response.ts:123-144) — before `end()`. So when opencode runs DIRECTLY IN THE PAGE (FirstWindowOwnerBinding, the M10 default), SSE already flows incrementally with ZERO new code. This must be the P4 target and the first thing the harness proves.

2. **page↔Worker hop** (`packages/net/src/cross-realm/preview-port.ts`): does NOT stream end-to-end. `bridgeCrossRealmPreview` (preview-port.ts:301) accumulates `reply-stream-chunk` frames and only resolves the `Response` on `reply-stream-end` (preview-port.ts:392-414). An SSE stream never ends, so an opencode-in-Worker deployment HANGS forever and trips the no-progress idle timer (preview-port.ts:313-322) at 30s. This is the real "buffered page-side limitation" the feature intent names. Fixing it = converting the page-side accumulator into a live `ReadableStream` that enqueues each chunk as it arrives (a new frame-version 3 of the page↔Worker contract).

**DECISION ON SCOPE:** deliver SSE over the page-direct path now (no new API, additive `ServerResponse` drain/pipe shim from feature 05 already enables Effect's streaming write loop), and treat the page↔Worker incremental rework as a SEPARATE, ratifiable contract bump (`PREVIEW_PORT_FRAME_VERSION` 2→3) that this feature SPECIFIES but does not silently ship. The PTY-connect WebSocket route stays stubbed (hard blocker). No `ws` shim is introduced.

## Decisions (classified)

### Decision 1 — Transport for the event stream: SSE-over-streaming-HTTP vs a `ws` shim

**⚠️ WARNING: IRREVERSIBLE — needs human ratification before merge. RECOMMENDED, not final.**

- **Question:** Transport for opencode's event stream: extend the existing SSE-over-streaming-HTTP bridge, or introduce a WebSocket (`ws`) shim?
- **Classification:** IRREVERSIBLE
- **Chosen (RECOMMENDED — awaiting ratification):** treat the event stream as SSE = a streaming HTTP `Response` and carry it over the EXISTING preview bridge. Do NOT add a `ws` shim for the event route. Rationale: opencode's `/event` route is `text/event-stream` over HTTP GET (Effect `HttpServerResponse.stream`), not a WebSocket; the only WS-shaped opencode route is PTY-connect, which is a documented hard blocker (PTY native). The SW→page hop already transfers `ReadableStream` zero-copy (route-preview.ts:131, body-transport.ts:55), and rifty `ServerResponse.toResponse()` resolves a live-stream `Response` at `flushHeaders()` (response.ts:123), so SSE works on the page-direct path with no transport change.
- **Alternatives:**
  - (a) Add a cross-realm `ws` shim and route the event stream as WebSocket frames. Rejected: opencode does not serve events over WS; a `ws` shim is a NEW public surface in packages/net AND would need the page to translate WS frames back to an EventSource the opencode SDK never asks for — pure impedance mismatch. The existing `BridgedWebSocket*` (ws/bridge.ts) is for HMR clients, same-origin BroadcastChannel, and explicitly does NOT cover the HTTP request/response that SSE rides on.
  - (b) Buffer the SSE response (the status quo): degrades the streaming event API to non-streaming — exactly the failure the feature exists to remove.
- **Trade-offs:** SSE-over-streaming-HTTP reuses a proven path (express@4 streaming precedent, ADR-0048 frames) and stays within the handler-shape-agnostic bridge. Cost: SSE keep-alive/reconnect semantics (EventSource auto-reconnect, `Last-Event-ID`) ride on top and need the response to actually stay open across the SW boundary — fine on the page-direct path, the gating issue on the Worker path (next decision). Marked IRREVERSIBLE only because formally ruling OUT a `ws` shim and pinning 'SSE=streaming-HTTP' as the event-stream contract is a cross-package architectural commitment worth an ADR; the page-direct implementation itself needs no new code.
- **Reversibility justification:** Reversibility rule 1 (touches the public contract of how streaming routes cross packages/net + packages/service-worker) and rule 3 proximity (it formally bounds ADR-0048's streaming-frame scope). Recommending, not deciding.
- **Proposed ADR:** ADR-00NN: opencode event stream rides SSE-over-streaming-HTTP on the preview bridge; no `ws` shim for the agent facade (PTY-connect WS stays stubbed)

### Decision 2 — Composing incremental SSE with the buffered page↔Worker limitation (frame-version bump)

**⚠️ WARNING: IRREVERSIBLE — needs human ratification before merge. RECOMMENDED, not final.**

- **Question:** How does incremental SSE compose with the buffered page↔Worker limitation (preview-port.ts reassembles on `reply-stream-end`, which never fires for SSE)?
- **Classification:** IRREVERSIBLE
- **Chosen (RECOMMENDED — awaiting ratification):** bump `PREVIEW_PORT_FRAME_VERSION` 2→3 (preview-port.ts:49) and make the page side (`bridgeCrossRealmPreview`) construct the `Response` from a live `ReadableStream` whose controller enqueues each `reply-stream-chunk` as it arrives, resolving the `Response` on `reply-stream-start` (not on `end`). The worker side (`serveCrossRealmPreview`) already streams chunk frames; v3 changes only the page reassembly contract and the no-progress timer semantics for never-ending bodies. Gate this behind v3 negotiation so un-bumped peers keep the v2 buffered fallback.
- **Alternatives:**
  - (a) Keep v2 and accept that opencode-in-Worker streaming hangs — document Worker deployment as 'buffered/non-streaming for SSE' and only support streaming on the page-direct path. This is the smallest-runnable choice and is the recommended SHIP order for THIS feature; the v3 bump is specified but deferred to when WorkerOwnerBinding (Q-2026-05-27-002, M11/A-023) is actually the opencode owner.
  - (b) Per-message MessageChannel instead of a frame-version bump — rejected, it forks the bridge and duplicates ADR-0048 logic.
  - (c) Switch the page↔Worker hop to a dedicated MessagePort with real backpressure (the M12/ADR-0017 endgame) — correct long-term but far larger than this feature.
- **Trade-offs:** v3 unlocks true incremental SSE in a Worker but is a non-additive change to a versioned cross-realm contract (the page no longer waits for `end` to resolve), so per ADR-0040's one-layer-down governance it needs the bump + ratification. The no-progress idle timer (preview-port.ts:313) must be re-specced for SSE: an infinite stream legitimately makes no progress between events, so for a streaming `Response` the timer should reset on EVERY chunk and tolerate the SSE keep-alive comment (`:\n`) opencode/Effect emits, or be disabled once the `Response` has been handed to the consumer. Getting that wrong reaps live event streams.
- **Reversibility justification:** Reversibility rule 3 (bumps a versioned wire contract governed by ADR-0048/ADR-0040) and rule 4 (>100 lines across preview-port.ts page+worker paths). Recommending the bump but shipping the page-direct path first; the bump is surfaced, not invented.
- **Proposed ADR:** ADR-00NN: PREVIEW_PORT_FRAME_VERSION 3 — incremental (never-ending) SSE over the page↔Worker bridge; idle-timer re-spec for streaming bodies

### Decision 3 — PTY-connect route (the only true WebSocket on opencode)

- **Question:** PTY-connect route (the only true WebSocket on opencode) — implement, or keep stubbed?
- **Classification:** PURE-IMPL
- **Chosen:** Keep it a throw-on-connect stub. PTY is a hard blocker (native node-pty/bun-pty); the route was already dropped/stubbed at P2 (drop ptyConnectApi). This feature does NOT touch it. blockerProximity is maximal here — the WS surface that DOES exist on opencode is exactly the one we must not build.
- **Alternatives:** Bridge PTY over the WS shim — impossible, no process/PTY in browser/WASI.
- **Trade-offs:** None; documenting the boundary is the whole point of the P5 ceiling marker (feature 09).
- **Reversibility justification:** Pure-impl: confirms an existing stub; no new code, no contract change.

### Decision 4 — SSE chunk-size / keep-alive interplay vs ADR-0048's MAX_CHUNK_BYTES framing

- **Question:** Where does the SSE chunk-size / keep-alive interplay live, and does ADR-0048's MAX_CHUNK_BYTES (64KiB) framing harm SSE event boundaries?
- **Classification:** REVERSIBLE
- **Chosen (provisional):** keep MAX_CHUNK_BYTES splitting (preview-port.ts:52) — it is byte-level on the page↔Worker hop and the page reassembles bytes, so SSE event framing (`data: …\n\n`) is preserved as long as the page hands bytes to a `TextDecoder`-fed EventSource without assuming one frame == one event. On the SW→page hop no splitting occurs (zero-copy stream transfer). Add a TODO(ADR) noting that an SSE event MAY span multiple 64KiB chunks and the page-side consumer must NOT treat a chunk boundary as an event boundary.
- **Alternatives:** Align chunk boundaries to SSE event boundaries (`\n\n`) — unnecessary coupling of a byte transport to a text protocol; rejected.
- **Trade-offs:** Byte-faithful framing is simplest and correct; the only risk is a downstream consumer that wrongly parses per-chunk, which is a consumer bug, not a transport one.
- **Reversibility justification:** Reversible: a single comment + a consumer contract note, no API change, <100 lines, no dep, no ADR conflict.
- **Q-id:** Q-2026-05-30-070

## Interface contract

**No NEW public symbol on the page-direct path (P4 ship):** SSE flows through existing surfaces unchanged —

- packages/net: `ServerResponse.toResponse(): Promise<Response>` (already resolves at flushHeaders, response.ts:224), `PortHandler = (Request)=>Promise<Response>|Response` (registry.ts:17).
- packages/service-worker: `packSerializedResponse(resp): Promise<{message, transfer}>` (body-transport.ts:55) and `SerializedResponse.body: ReadableStream | Uint8Array | null` (protocol.ts:133) — already streaming-capable.

**CHANGED (Worker path, only if the v3 bump is ratified):**

- packages/net `PREVIEW_PORT_FRAME_VERSION: '2' -> '3'` (preview-port.ts:49) — versioned wire constant; this is the cross-package public contract that triggers IRREVERSIBLE.
- `bridgeCrossRealmPreview(port, opts)` signature UNCHANGED; behaviour CHANGED: resolves the returned `Response` on `reply-stream-start` with a body backed by a live `ReadableStream` controller, enqueuing on each `reply-stream-chunk`, closing on `reply-stream-end`, erroring on `reply-stream-error`/seq-gap/timeout. New opt field (additive, optional): `{ readonly streamingResponses?: boolean }` defaulting to true under v3 so a caller can force the v2 buffered behaviour for non-SSE routes if needed.

**NOT INTRODUCED:** no `ws`-shaped API for the event route; the existing `BridgedWebSocket*` (ws/bridge.ts) is untouched and remains HMR-only. PTY-connect stays a stub (throws on connect).

## Affected packages & seams

**Affected packages:**

- `packages/net`
- `packages/service-worker`

**Seam anchors:**

- `packages/net/src/cross-realm/preview-port.ts:49`
- `packages/net/src/cross-realm/preview-port.ts:301`
- `packages/net/src/cross-realm/preview-port.ts:392`
- `packages/net/src/cross-realm/preview-port.ts:313`
- `packages/net/src/http/response.ts:123`
- `packages/net/src/http/response.ts:224`
- `packages/net/src/registry.ts:17`
- `packages/service-worker/src/route-preview.ts:131`
- `packages/service-worker/src/body-transport.ts:55`
- `packages/service-worker/src/protocol.ts:133`

## Dependencies

**Depends on:**

- `05-effect-http-bridge`
- `06-headless-server-boot`
- `08-llm-flow`

**Blocker proximity:** CLOSEST to a hard blocker of any feature in the program: the term "WS" in the feature name collides directly with the PTY-connect WebSocket route, which is a HARD BLOCKER (native PTY). The design stays on the feasible side by reclassifying the actual target — opencode's `/event` route is SSE-over-streaming-HTTP, not WebSocket — and explicitly refusing to build a `ws` shim for it. SSE is pure HTTP: it requires only a long-lived streaming `Response`, which the SW→page hop already carries (route-preview.ts:131) and rifty `ServerResponse` already produces at flushHeaders (response.ts:123). The only true WebSocket on opencode (PTY-connect) is left as a throw-on-connect stub, and the existing HMR `BridgedWebSocket` is untouched. The one remaining proximity is the page↔Worker BroadcastChannel hop's buffered reassembly (preview-port.ts:392), which is a versioned-contract limitation (fixable by a ratified v3 bump), NOT a browser/WASI ceiling — so it is firmly on the feasible side. No process spawn, no PTY, no native socket is implied anywhere in this design.

## Test strategy

Levels, gold-standard-first:

1. **PARITY (page-direct SSE, the P4 ship target):** fork the headless harness (tests/integration/fixtures/real-vite-smoke.ts pattern) to boot opencode programmatically via `Server.listen(opts)` (feature 06), hit `/event` through the registry/`dispatchToPort`, and compare against Node running the same opencode server: assert (a) the `Response` resolves BEFORE the stream ends (read headers + first `data:` frame while `done===false`), (b) the byte stream of SSE frames matches Node's for a fixed sequence of bus events. Parity is the right level because SSE framing is Node-compatible behavior. Requires sandbox-disabled (live provider/storage), per the running-real-packages methodology.

2. **UNIT (transport mechanics):** on `ServerResponse` (response.ts) assert `toResponse()` resolves at `flushHeaders()` and the returned `Response.body` yields chunks incrementally as `write()` is called (no buffering to `end`). On `body-transport.ts` assert `packSerializedResponse` transfers a `ReadableStream` (transfer list non-empty) when `canTransferReadableStream()` is true and drains to `Uint8Array` otherwise — the SSE fallback path.

3. **UNIT/CONFORMANCE (Worker-path v3, only if ratified):** a `serveCrossRealmPreview`↔`bridgeCrossRealmPreview` round-trip over a fake/`BroadcastChannel` mock feeding an UNENDED stream; assert the page `Response` resolves on `reply-stream-start`, each enqueued chunk is observable via `response.body.getReader()` before any `end`, the no-progress timer does NOT fire while chunks keep arriving, and a worker-death mid-stream surfaces as a stream error after `timeoutMs`. Plus a NEGATIVE conformance test: a v2 page against a v3 worker (and vice-versa) negotiates the buffered fallback or 503s per the version-mismatch contract — mirrors the existing SW_FRAME_VERSION mismatch tests.

4. **E2E (deferred to playwright, post-ratification):** EventSource in a real page subscribed to `/preview/<port>/event` receives at least 2 distinct events with a measurable gap, proving end-to-end incremental delivery across the actual SW. Chromium first (default), then all-3 since Safari's transferable-stream support gates the fast path.

No test is modified to make code pass; the v2 buffered tests stay green and a new v3 suite is added alongside.

## Implementation plan (test-first)

1. **T1 — P4 SHIP TARGET — parity proof that opencode's /event SSE stream flows INCREMENTALLY on the page-direct path with zero new code.** [kind: parity]
   Fork the headless harness (tests/integration/fixtures/real-vite-smoke.ts pattern) into an opencode harness that boots the server programmatically via Server.listen(opts) (feature 06) instead of the CLI, registers in the port registry, and hits /event through dispatchToPort. Run sandbox-disabled (live provider/storage per running-real-packages methodology). Compare against Node running the same opencode server: the Response must resolve while the stream is still open, and the SSE byte sequence must match Node's for a fixed sequence of bus events.
   - **Failing test to write first:** tests/integration parity case 'opencode /event SSE resolves before stream end and matches Node frame bytes': boot server via Server.listen; `const res = await dispatchToPort(port, new Request('http://preview.local/event'))`; assert `res.headers.get('content-type')` startsWith 'text/event-stream'; `const reader = res.body.getReader()`; `const {done, value} = await reader.read()`; `expect(done).toBe(false)`; `expect(new TextDecoder().decode(value)).toContain('data:')`; then assert the concatenated frame bytes for N scripted bus events === Node-runtime bytes for the same script. FAILS until the opencode harness exists (depends 05/06/08).
   - **Files:** `tests/integration/fixtures/real-opencode-sse-smoke.ts`, `tests/integration/opencode-sse-live-run.opt-in.test.ts`

2. **T2 — Lock the transport invariant on ServerResponse that SSE depends on.** [kind: unit]
   `toResponse()` resolves at flushHeaders() (BEFORE end()), and Response.body yields each written chunk incrementally with NO buffering until end(). This is the response.ts:123/224 guarantee feature 05's drain/pipe shim relies on; pin it so a future refactor cannot regress SSE into a buffered response.
   - **Failing test to write first:** packages/net/src/http/response.test.ts add 'toResponse() resolves before end() and body streams each write incrementally (SSE invariant)': `const res = new ServerResponse(); res.writeHead(200,{'content-type':'text/event-stream'}); res.write('data: a\n\n'); const response = await res.toResponse(); const reader = response.body.getReader(); const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toBe('data: a\n\n'); expect(res.writableEnded).toBe(false); res.write('data: b\n\n'); const second = await reader.read(); expect(new TextDecoder().decode(second.value)).toBe('data: b\n\n')`. FAILS if any code buffers to end.
   - **Files:** `packages/net/src/http/response.test.ts`

3. **T3 — Lock the SW→page body-carrier behavior SSE rides on.** [kind: unit]
   `packSerializedResponse` transfers a ReadableStream zero-copy (transfer list non-empty) when canTransferReadableStream() is true, and drains to a Uint8Array when not. Make the SSE consequence explicit: the drain fallback buffers an unending stream — so the no-transferable-stream realm is the documented ceiling for SSE, not the streaming path.
   - **Failing test to write first:** packages/service-worker/src/body-transport.test.ts add 'packSerializedResponse transfers a live ReadableStream (SSE fast path) and drains otherwise': with `canTransferReadableStream()===true`, pack a Response backed by a never-ending ReadableStream and assert `result.transfer.length===1` and `result.message.body` is the SAME ReadableStream instance (NOT drained, proving it does not block on an unending body); then force the unsupported branch (stub canTransferReadableStream) with a FINITE stream and assert `result.transfer.length===0` and `result.message.body instanceof Uint8Array`. FAILS if the fast path is missing or if pack awaits an unending stream.
   - **Files:** `packages/service-worker/src/body-transport.test.ts`

4. **T4 — Confirm the route-preview reconstruction keeps the live stream.** [kind: conformance]
   `routePreview` rebuilds `new Response(raw,…)` directly from a transferred ReadableStream (route-preview.ts:131) without draining, so an SSE body stays incremental SW→page. Add a regression test driving a SerializedResponse whose body is a live ReadableStream and asserting the reconstructed Response yields a chunk before the source stream closes. Then update compat-matrix: SSE/event-stream over the page-direct preview bridge = supported; over the Worker path = buffered/not-streaming until v3 (T5-7); PTY-connect WebSocket = not-supported (hard blocker).
   - **Failing test to write first:** packages/service-worker/src/route-preview.test.ts add 'reconstructs a live ReadableStream Response without draining (SSE SW→page)': drive routePreview with a fake binding/client whose reply posts a SerializedResponse `{status:200, headers:{'content-type':'text/event-stream'}, body: <live ReadableStream that enqueues one frame then stays open>}`; assert the returned Response content-type is text/event-stream and `reader.read()` yields the first 'data:' frame while the source controller is still open (`done===false`). FAILS if routePreview drains/buffers the body.
   - **Files:** `packages/service-worker/src/route-preview.test.ts`, `docs/compat/`

5. **T5 — BLOCKED ON ADR #2. V3 page-side incremental reassembly.** [kind: conformance]
   Bump PREVIEW_PORT_FRAME_VERSION 2→3 and make bridgeCrossRealmPreview resolve the Response on reply-stream-start from a live ReadableStream whose controller enqueues each reply-stream-chunk and closes on reply-stream-end. The existing v2 buffered tests stay green (negotiated fallback). DO NOT modify the v2 streaming tests; add a v3 suite alongside (CLAUDE.md: never modify a test to make code pass).
   - **Failing test to write first:** packages/net/src/cross-realm/preview-port.test.ts add suite 'preview port v3 — incremental SSE': using rawWorker to post start→chunk(seq0)→[pause]→chunk(seq1)→...(never end), assert the page Response RESOLVES on reply-stream-start (before any chunk) with the start headers, and that `response.body.getReader()` yields chunk0 bytes BEFORE chunk1 is posted (incremental, not reassembled-on-end). Pin v: expect the request frame the worker receives to carry `v==='3'`. FAILS under current v2 (resolves only on reply-stream-end).
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`, `docs/adr/`

6. **T6 — BLOCKED ON ADR #2. Re-spec the no-progress idle timer for never-ending v3 streams; surface mid-stream worker death as a stream ERROR.** [kind: conformance]
   `controller.error` rather than a buffered 502, since the Response is already handed to the consumer. Timer re-arms on every chunk and tolerates SSE keep-alive comments (`:\n`); a worker that goes silent for >timeoutMs after start errors the live stream.
   - **Failing test to write first:** packages/net/src/cross-realm/preview-port.test.ts (v3 suite) add 'v3 idle timer: live SSE keep-alive never reaps; silent worker errors the handed-out stream': (a) rawWorker posts start then a keep-alive comment chunk every <timeoutMs for longer than timeoutMs total and the reader keeps yielding (no error); (b) rawWorker posts start + chunk0 then goes silent, assert response already resolved AND `reader.read()` REJECTS (stream errored) after ~timeoutMs, not that a fresh 502 Response is returned. FAILS under v2 (502 returned instead of erroring an open stream; timer reaps the live stream).
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`

7. **T7 — BLOCKED ON ADR #2. Version negotiation across the v3 bump.** [kind: conformance]
   A v3 page against a v2 worker still works via the buffered `reply` fast path; a v2 page against a v3 worker negotiates the buffered fallback or 503s per the existing mismatch contract (preview-port.ts:360-368). Mirror the existing SW_FRAME_VERSION mismatch tests. Also keep the byte-faithful MAX_CHUNK_BYTES splitting and add the Q-2026-05-30-070 TODO(ADR) note that one SSE event MAY span multiple 64KiB chunks so the consumer must not treat a chunk boundary as an event boundary.
   - **Failing test to write first:** packages/net/src/cross-realm/preview-port.test.ts (v3 suite) add 'negotiation: v3 page <-> v2 worker buffers; v2 frame against v3 page -> 503': (a) rawWorker replying with buffered `reply` (no v or `v='2'`) against a v3 bridgeCrossRealmPreview resolves a correct buffered Response; (b) rawWorker posts reply-stream-start with `v='2'` to a v3 page and asserts 503 + `console.error(expected:'3', got:'2')`. Plus 'an SSE event split across two 64KiB chunks reassembles into one event for a byte-fed consumer'. FAILS until v3 negotiation + boundary note exist.
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`, `OPEN_QUESTIONS.md`

### Scaffolding sketch

```ts
// ── P4 SHIP PATH (page-direct) — NO new public symbol. Only proves + locks existing behavior. ──

// packages/net/src/http/response.ts  (EXISTING — no signature change)
//   toResponse(): Promise<Response>   resolves at flushHeaders() (response.ts:123,224) — confirmed
//   write(chunk): boolean | Promise<boolean>  — enqueues live, never buffers to end()
// The SSE proof asserts toResponse() resolves BEFORE end(), and Response.body yields
// each `data: ...\n\n` frame incrementally as write() is called. No code change expected;
// if a test reveals buffering, the fix is local to response.ts (still no API change).

// packages/service-worker/src/body-transport.ts (EXISTING — no signature change)
//   packSerializedResponse(resp): Promise<{message, transfer}>  — transfer non-empty for a
//   ReadableStream when canTransferReadableStream(); drains to Uint8Array fallback otherwise.
// SSE relies on the transfer (zero-copy) path. The fallback DRAINS — which buffers an
// unending SSE stream forever; document that as the no-transferable-stream ceiling.

// ── V3 SPEC PATH (page↔Worker) — BLOCKED until ADR ratified. Sketch only; do NOT ship. ──

// packages/net/src/cross-realm/preview-port.ts
export const PREVIEW_PORT_FRAME_VERSION = '3'; // was '2' (preview-port.ts:49) — IRREVERSIBLE wire bump

// bridgeCrossRealmPreview: signature UNCHANGED; behaviour CHANGED under v3.
export function bridgeCrossRealmPreview(
  port: number,
  opts?: { readonly timeoutMs?: number; readonly streamingResponses?: boolean }, // additive opt, default true under v3
): CrossRealmPortHandler;
// On 'reply-stream-start': build `new Response(liveStream, {status,statusText,headers})` from a
//   ReadableStream whose controller is captured; RESOLVE the waiter NOW (not on end).
// On 'reply-stream-chunk': controller.enqueue(copy); re-arm idle timer.
// On 'reply-stream-end': controller.close().
// On 'reply-stream-error' / seq-gap / dispose / timeout: controller.error(...) (Response already handed out).
interface StreamAccumulator {            // v3 replaces buffered accumulator
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  resolved: boolean;
  nextSeq: number;
}
// Idle-timer re-spec: armed on start, re-armed on every chunk; once Response handed to consumer
//   the timer reaps only a STALLED worker (no chunk within timeoutMs), never a legitimately-idle
//   long-lived SSE stream that is mid keep-alive.

// serveCrossRealmPreview: UNCHANGED (already emits start→chunks→end; preview-port.ts:208-255).

// Negotiation: page stamps v='3' on `request`; a v2 worker still replies buffered `reply` (works);
//   a v2 page against a v3 worker validates v on reply-stream-start and 503s (existing path,
//   preview-port.ts:360-368) — the mismatch contract is reused, not reinvented.

// NOT INTRODUCED anywhere: no `ws` shim for /event. BridgedWebSocket* (ws/bridge.ts) untouched.
// PTY-connect route stays a throw-on-connect stub (hard blocker).
```

### Risks

- The whole P4 ship rests on T1's opencode harness, which depends on features 05 (Effect HTTP bridge), 06 (headless Server.listen boot) and 08 (LLM flow) being done. If 06 cannot boot the server programmatically (make-or-break unknown #1: HttpApiApp.createRoutes statically importing the storage/Database layer trips bun:sqlite at layer-build time), T1 cannot run and the SSE claim is unproven. T1 must be sequenced AFTER 06 lands, not in parallel.
- make-or-break unknown #2 (IncomingMessage/ServerResponse shapes fully reproducible over the bridge): if Effect's HttpServerResponse.stream depends on a ServerResponse surface rifty doesn't reproduce (e.g. flushHeaders timing, or a write() return-type assumption — note rifty widens write() to `boolean|Promise<boolean>`, response.ts:160), SSE may stall at the source before any transport question. T2 pins the rifty side but cannot pin Effect's expectations; T1 parity is the only place that surfaces it.
- The drain fallback in packSerializedResponse (body-transport.ts:68) will hang FOREVER on an unending SSE body in a realm without transferable streams (older Safari/some Workers). T3 documents this as a ceiling, but if a real deployment lands on that realm, SSE silently never delivers. The compat-matrix note (T4) must be loud; consider a guard that refuses to drain a body whose content-type is text/event-stream rather than hanging — but that guard is itself a behavior change needing its own ticket (do not bundle).
- V3 idle-timer re-spec (T6) is the highest-blast-radius change: getting it wrong reaps live event streams (the design explicitly warns 'getting that wrong reaps live event streams'). The timer must distinguish a legitimately-idle long-lived SSE stream from a dead worker — the design's chosen rule (re-arm on every chunk incl keep-alive `:\n`, reap only on silence past timeoutMs) must be encoded as an explicit test (T6a/b) BEFORE the implementation, and the v2 idle tests must stay untouched.
- V3 changes the resolution semantics from resolve-on-end to resolve-on-start: any current page-side consumer that assumes the Response is fully buffered when it resolves (e.g. reads .arrayBuffer() expecting completeness) breaks. The bump is gated behind negotiation (T7), but in-repo callers of bridgeCrossRealmPreview must be audited before T5 ships — an unaudited caller is a silent regression.
- Scope-creep temptation: the feature name says 'ws-sse-bridge'. The design correctly reclassifies /event as SSE-over-HTTP and refuses a ws shim, but a reviewer may push to also bridge PTY-connect. That is a hard blocker (native PTY) and must stay a throw-on-connect stub; touching it would invert the feasibility verdict.

### Estimate

P4 ship path (T1–T4): ~3 evenings (T1 harness fork is the bulk; T2/T3 unit locks ~1 evening; T4 doc/compat ~0.5). V3 spec path (T5–T7), only after ADR #2 ratifies: ~4 evenings (conformance round-trip + idle-timer re-spec + negotiation/mismatch + e2e deferred to playwright). Total ~7 evening-units, of which 4 are gated.

### Ratification gate

**BLOCKED-IN-PART.** Two decisions in the design are flagged needsHumanRatification and are IRREVERSIBLE by the checklist:

1. ADR-00NN "opencode event stream rides SSE-over-streaming-HTTP on the preview bridge; no `ws` shim (PTY-connect WS stays stubbed)" — formally rules OUT a ws shim and pins SSE=streaming-HTTP as the event-stream contract across packages/net + packages/service-worker (reversibility rule 1, proximity to ADR-0048 scope). The page-direct IMPLEMENTATION needs no new code, so tasks T1–T4 (P4 ship + unit locks + ceiling doc) can proceed under the recommended decision and only require this ADR to be RATIFIED before merge, not before work.

2. ADR-00NN "PREVIEW_PORT_FRAME_VERSION 3 — incremental never-ending SSE over the page↔Worker bridge; idle-timer re-spec" — bumps a versioned wire contract governed by ADR-0048/ADR-0040 and edits >100 lines across the page+worker paths (reversibility rules 3 and 4). Tasks T5–T7 are HARD-BLOCKED: do not write or ship the v3 bump until this ADR is ratified. They are included so the failing tests are specified, but they must not be committed pre-ratification (CLAUDE.md: IRREVERSIBLE decisions must not be invented).

**Net:** T1–T4 proceed now (merge-gated on ADR #1). T5–T7 fully blocked on ADR #2. Q-2026-05-30-070 (chunk-vs-event-boundary note) is REVERSIBLE — log + TODO(ADR), no gate.
