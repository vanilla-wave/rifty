# Feature 07-ws-sse-bridge — ws-over-SW bridge for the SSE/event stream route

> Part of the opencode-in-rifty facade effort. Feasibility phase P4. Staged doc — NOT a ratified ADR.

## Summary

opencode's `/event` route is server-sent events: a long-lived HTTP GET whose body is a `text/event-stream` `ReadableStream` from Effect's `HttpServerResponse.stream`. It is NOT a WebSocket — the only WS-shaped surface on opencode is the PTY-connect route, which stays a hard-blocked stub. So the transport here is "SSE = streaming HTTP response", NOT a `ws` shim. An SSE response is just a `Response` whose body never ends until the client disconnects.

Two hops carry that body in rifty, and they differ sharply:

1. **SW→page hop** (`packages/service-worker/src/route-preview.ts:131`, `body-transport.ts:55`): ALREADY streams. `packSerializedResponse` transfers a `ReadableStream` zero-copy where the realm supports transferable streams (Chromium ≥89, FF ≥103, Safari ≥16.4); `routePreview` reconstructs `new Response(raw, …)` from the transferred stream. The page-side handler is opencode's `webHandler()` returning rifty `ServerResponse`, whose `toResponse()` resolves a live-`ReadableStream`-backed `Response` the moment `flushHeaders()` runs (response.ts:123-144) — before `end()`. So when opencode runs DIRECTLY IN THE PAGE (FirstWindowOwnerBinding, the M10 default), SSE already flows incrementally with ZERO new code. This is the P4 target the harness must prove first.

2. **page↔Worker hop** (`packages/net/src/cross-realm/preview-port.ts`): does NOT stream end-to-end. `bridgeCrossRealmPreview` (preview-port.ts:301) accumulates `reply-stream-chunk` frames and resolves the `Response` only on `reply-stream-end` (preview-port.ts:392-414). An SSE stream never ends, so opencode-in-Worker HANGS and trips the no-progress idle timer (preview-port.ts:313-322) at 30s. This is the real "buffered page-side limitation" the feature names. Fix = page-side accumulator becomes a live `ReadableStream` enqueuing each chunk on arrival (frame-version 3 of the page↔Worker contract).

**SCOPE DECISION:** ship SSE over the page-direct path now (no new API; feature 05's additive `ServerResponse` drain/pipe shim already enables Effect's streaming write loop). Treat the page↔Worker incremental rework as a SEPARATE, ratifiable contract bump (`PREVIEW_PORT_FRAME_VERSION` 2→3) that this feature SPECIFIES but does not silently ship. PTY-connect WS stays stubbed (hard blocker). No `ws` shim is introduced.

## Decisions (classified)

### Decision 1 — Event-stream transport: SSE-over-streaming-HTTP vs a `ws` shim

**⚠️ IRREVERSIBLE — needs human ratification before merge. RECOMMENDED, not final.**

- **Question:** Extend the existing SSE-over-streaming-HTTP bridge, or introduce a WebSocket (`ws`) shim for opencode's event stream?
- **Classification:** IRREVERSIBLE
- **Chosen (RECOMMENDED — awaiting ratification):** treat the event stream as SSE = a streaming HTTP `Response` over the EXISTING preview bridge; no `ws` shim. Rationale: `/event` is `text/event-stream` over HTTP GET (Effect `HttpServerResponse.stream`), not a WebSocket; the only WS-shaped opencode route is PTY-connect, a documented hard blocker (native PTY). The SW→page hop already transfers `ReadableStream` zero-copy (route-preview.ts:131, body-transport.ts:55), and `ServerResponse.toResponse()` resolves a live-stream `Response` at `flushHeaders()` (response.ts:123) — so SSE works on the page-direct path with no transport change.
- **Alternatives:**
  - (a) Cross-realm `ws` shim routing the event stream as WS frames. Rejected: opencode does not serve events over WS; a shim is a NEW public surface in packages/net AND forces the page to translate WS frames back to an EventSource the SDK never asks for — pure impedance mismatch. Existing `BridgedWebSocket*` (ws/bridge.ts) is HMR-only (same-origin BroadcastChannel) and explicitly does NOT cover the HTTP request/response SSE rides on.
  - (b) Buffer the SSE response (status quo): degrades the streaming API to non-streaming — the exact failure this feature removes.
- **Trade-offs:** SSE-over-streaming-HTTP reuses a proven path (express@4 streaming precedent, ADR-0048 frames) and stays handler-shape-agnostic. Cost: SSE keep-alive/reconnect (EventSource auto-reconnect, `Last-Event-ID`) need the response to stay open across the SW boundary — fine on the page-direct path, the gating issue on the Worker path (Decision 2). IRREVERSIBLE only because formally ruling OUT a `ws` shim and pinning "SSE=streaming-HTTP" is a cross-package commitment worth an ADR; the page-direct implementation needs no new code.
- **Reversibility justification:** Rule 1 (public contract for how streaming routes cross packages/net + packages/service-worker) and rule 3 proximity (bounds ADR-0048's streaming-frame scope). Recommending, not deciding.
- **Proposed ADR:** ADR-00NN — opencode event stream rides SSE-over-streaming-HTTP on the preview bridge; no `ws` shim for the agent facade (PTY-connect WS stays stubbed).

### Decision 2 — Incremental SSE vs the buffered page↔Worker limitation (frame-version bump)

**⚠️ IRREVERSIBLE — needs human ratification before merge. RECOMMENDED, not final.**

- **Question:** How does incremental SSE compose with the buffered page↔Worker path (preview-port.ts reassembles on `reply-stream-end`, which never fires for SSE)?
- **Classification:** IRREVERSIBLE
- **Chosen (RECOMMENDED — awaiting ratification):** bump `PREVIEW_PORT_FRAME_VERSION` 2→3 (preview-port.ts:49); make the page side (`bridgeCrossRealmPreview`) build the `Response` from a live `ReadableStream` whose controller enqueues each `reply-stream-chunk` on arrival, resolving on `reply-stream-start` (not `end`). The worker side (`serveCrossRealmPreview`) already streams chunk frames; v3 changes only page reassembly and the no-progress timer semantics for never-ending bodies. Gate behind v3 negotiation so un-bumped peers keep the v2 buffered fallback.
- **Alternatives:**
  - (a) Keep v2, accept opencode-in-Worker streaming HANGS — document Worker deployment as buffered/non-streaming for SSE, support streaming only page-direct. Smallest-runnable; the recommended SHIP order for THIS feature. The v3 bump is specified but deferred to when WorkerOwnerBinding (Q-2026-05-27-002, M11/A-023) actually owns opencode.
  - (b) Per-message MessageChannel instead of a frame-version bump — rejected; forks the bridge and duplicates ADR-0048 logic.
  - (c) Dedicated MessagePort with real backpressure (M12/ADR-0017 endgame) — correct long-term but far larger than this feature.
- **Trade-offs:** v3 unlocks true in-Worker SSE but is a non-additive change to a versioned cross-realm contract (page no longer waits for `end`), so per ADR-0040's one-layer-down governance it needs the bump + ratification. The no-progress idle timer (preview-port.ts:313) must be re-specced: an infinite stream legitimately makes no progress between events, so for a streaming `Response` the timer must reset on EVERY chunk, tolerate the SSE keep-alive comment (`:\n`) opencode/Effect emits, or be disabled once the `Response` is handed to the consumer. Getting it wrong reaps live event streams.
- **Reversibility justification:** Rule 3 (bumps a versioned wire contract governed by ADR-0048/ADR-0040) and rule 4 (>100 lines across preview-port.ts page+worker paths). Recommending the bump; shipping the page-direct path first.
- **Proposed ADR:** ADR-00NN — PREVIEW_PORT_FRAME_VERSION 3: incremental (never-ending) SSE over the page↔Worker bridge; idle-timer re-spec for streaming bodies.

### Decision 3 — PTY-connect route (opencode's only true WebSocket)

- **Question:** PTY-connect route — implement or keep stubbed?
- **Classification:** PURE-IMPL
- **Chosen:** throw-on-connect stub. PTY is a hard blocker (native node-pty/bun-pty); already dropped/stubbed at P2 (drop ptyConnectApi). This feature does NOT touch it. blockerProximity is maximal: the WS surface that DOES exist on opencode is exactly the one we must not build.
- **Alternatives:** Bridge PTY over a WS shim — impossible; no process/PTY in browser/WASI.
- **Trade-offs:** None; documenting the boundary is the whole point of the P5 ceiling marker (feature 09).
- **Reversibility justification:** Pure-impl: confirms an existing stub; no new code, no contract change.

### Decision 4 — SSE chunk-size / keep-alive vs ADR-0048's MAX_CHUNK_BYTES framing

- **Question:** Where does SSE chunk-size / keep-alive interplay live, and does ADR-0048's MAX_CHUNK_BYTES (64KiB) framing harm SSE event boundaries?
- **Classification:** REVERSIBLE
- **Chosen (provisional):** keep MAX_CHUNK_BYTES splitting (preview-port.ts:52) — it is byte-level on the page↔Worker hop and the page reassembles bytes, so SSE framing (`data: …\n\n`) is preserved as long as the page feeds bytes to a `TextDecoder`-backed EventSource without assuming one frame == one event. The SW→page hop does no splitting (zero-copy transfer). Add a TODO(ADR): one SSE event MAY span multiple 64KiB chunks; the page-side consumer must NOT treat a chunk boundary as an event boundary.
- **Alternatives:** Align chunk boundaries to SSE event boundaries (`\n\n`) — unnecessary coupling of a byte transport to a text protocol; rejected.
- **Trade-offs:** Byte-faithful framing is simplest and correct; the only risk is a downstream consumer that wrongly parses per-chunk — a consumer bug, not a transport one.
- **Reversibility justification:** Reversible: a comment + a consumer contract note; no API change, <100 lines, no dep, no ADR conflict.
- **Q-id:** Q-2026-05-30-070

## Interface contract

**No NEW public symbol on the page-direct path (P4 ship)** — SSE flows through existing surfaces:

- packages/net: `ServerResponse.toResponse(): Promise<Response>` (resolves at flushHeaders, response.ts:224); `PortHandler = (Request)=>Promise<Response>|Response` (registry.ts:17).
- packages/service-worker: `packSerializedResponse(resp): Promise<{message, transfer}>` (body-transport.ts:55); `SerializedResponse.body: ReadableStream | Uint8Array | null` (protocol.ts:133) — already streaming-capable.

**CHANGED (Worker path, only if v3 ratified):**

- packages/net `PREVIEW_PORT_FRAME_VERSION: '2' -> '3'` (preview-port.ts:49) — versioned wire constant; the cross-package public contract that triggers IRREVERSIBLE.
- `bridgeCrossRealmPreview(port, opts)` — signature UNCHANGED, behaviour CHANGED: resolves the `Response` on `reply-stream-start` with a body backed by a live `ReadableStream` controller; enqueues on each `reply-stream-chunk`; closes on `reply-stream-end`; errors on `reply-stream-error`/seq-gap/timeout. New additive optional opt `{ readonly streamingResponses?: boolean }`, default true under v3, lets a caller force v2 buffered behaviour for non-SSE routes.

**NOT INTRODUCED:** no `ws`-shaped API for the event route; existing `BridgedWebSocket*` (ws/bridge.ts) untouched and HMR-only. PTY-connect stays a stub (throws on connect).

## Affected packages & seams

**Packages:** `packages/net`, `packages/service-worker`.

**Seam anchors:**

| File:line | Role |
|---|---|
| `packages/net/src/cross-realm/preview-port.ts:49` | PREVIEW_PORT_FRAME_VERSION constant |
| `packages/net/src/cross-realm/preview-port.ts:301` | bridgeCrossRealmPreview |
| `packages/net/src/cross-realm/preview-port.ts:392` | reply-stream-end reassembly |
| `packages/net/src/cross-realm/preview-port.ts:313` | no-progress idle timer |
| `packages/net/src/http/response.ts:123` | toResponse resolves at flushHeaders |
| `packages/net/src/http/response.ts:224` | toResponse signature |
| `packages/net/src/registry.ts:17` | PortHandler type |
| `packages/service-worker/src/route-preview.ts:131` | Response reconstruction |
| `packages/service-worker/src/body-transport.ts:55` | packSerializedResponse |
| `packages/service-worker/src/protocol.ts:133` | SerializedResponse.body |

## Dependencies

**Depends on:** `05-effect-http-bridge`, `06-headless-server-boot`, `08-llm-flow`.

**Blocker proximity:** CLOSEST to a hard blocker of any feature in the program — the name's "WS" collides with the PTY-connect WebSocket route, a HARD BLOCKER (native PTY). The design stays feasible by reclassifying the target: `/event` is SSE-over-streaming-HTTP, not WebSocket, and it explicitly refuses a `ws` shim. SSE is pure HTTP — just a long-lived streaming `Response`, which the SW→page hop already carries (route-preview.ts:131) and rifty `ServerResponse` already produces at flushHeaders (response.ts:123). The only true WebSocket (PTY-connect) stays a throw-on-connect stub; HMR `BridgedWebSocket` is untouched. The one remaining proximity — the page↔Worker BroadcastChannel hop's buffered reassembly (preview-port.ts:392) — is a versioned-contract limitation (fixable by a ratified v3 bump), NOT a browser/WASI ceiling, so firmly feasible. No process spawn, PTY, or native socket anywhere in this design.

## Test strategy

Gold-standard-first:

1. **PARITY (page-direct SSE — the P4 ship target):** fork the headless harness (tests/integration/fixtures/real-vite-smoke.ts pattern) to boot opencode via `Server.listen(opts)` (feature 06), hit `/event` through the registry/`dispatchToPort`, and diff against Node running the same opencode server. Assert (a) the `Response` resolves BEFORE the stream ends (read headers + first `data:` frame while `done===false`); (b) the SSE byte stream matches Node's for a fixed bus-event sequence. Parity is right because SSE framing is Node-compatible behavior. Requires sandbox-disabled (live provider/storage), per running-real-packages methodology.

2. **UNIT (transport mechanics):** on `ServerResponse` (response.ts) assert `toResponse()` resolves at `flushHeaders()` and `Response.body` yields chunks incrementally per `write()` (no buffering to `end`). On `body-transport.ts` assert `packSerializedResponse` transfers a `ReadableStream` (non-empty transfer list) when `canTransferReadableStream()`, else drains to `Uint8Array` (the SSE fallback path).

3. **UNIT/CONFORMANCE (Worker-path v3, only if ratified):** a `serveCrossRealmPreview`↔`bridgeCrossRealmPreview` round-trip over a fake/`BroadcastChannel` mock feeding an UNENDED stream. Assert the page `Response` resolves on `reply-stream-start`; each enqueued chunk is observable via `response.body.getReader()` before any `end`; the no-progress timer does NOT fire while chunks arrive; mid-stream worker death surfaces as a stream error after `timeoutMs`. Plus a NEGATIVE conformance test: v2 page vs v3 worker (and vice-versa) negotiates the buffered fallback or 503s per the version-mismatch contract — mirrors existing SW_FRAME_VERSION mismatch tests.

4. **E2E (deferred to playwright, post-ratification):** EventSource in a real page subscribed to `/preview/<port>/event` receives ≥2 distinct events with a measurable gap, proving end-to-end incremental delivery across the actual SW. Chromium first (default), then all-3 since Safari's transferable-stream support gates the fast path.

No test is modified to make code pass; v2 buffered tests stay green and a new v3 suite is added alongside.

## Implementation plan (test-first)

1. **T1 — P4 SHIP TARGET — parity proof that `/event` SSE flows INCREMENTALLY on the page-direct path with zero new code.** [parity]
   Fork the headless harness (real-vite-smoke.ts pattern) into an opencode harness booting via `Server.listen(opts)` (feature 06) instead of the CLI, registering in the port registry, hitting `/event` through `dispatchToPort`. Sandbox-disabled (live provider/storage). Diff against Node running the same server: the `Response` must resolve while the stream is open, and SSE bytes must match Node's for a fixed bus-event sequence.
   - **Failing test first:** tests/integration parity case 'opencode /event SSE resolves before stream end and matches Node frame bytes': `const res = await dispatchToPort(port, new Request('http://preview.local/event'))`; assert `res.headers.get('content-type')` startsWith `'text/event-stream'`; `const {done, value} = await res.body.getReader().read()`; `expect(done).toBe(false)`; decoded value `.toContain('data:')`; then concatenated frame bytes for N scripted bus events === Node-runtime bytes for the same script. FAILS until the opencode harness exists (depends 05/06/08).
   - **Files:** `tests/integration/fixtures/real-opencode-sse-smoke.ts`, `tests/integration/opencode-sse-live-run.opt-in.test.ts`

2. **T2 — Lock the `ServerResponse` transport invariant SSE depends on.** [unit]
   `toResponse()` resolves at flushHeaders() (BEFORE end()); `Response.body` yields each written chunk incrementally, NO buffering until end(). This is the response.ts:123/224 guarantee feature 05's drain/pipe shim relies on; pin it so a refactor cannot regress SSE into a buffered response.
   - **Failing test first:** response.test.ts add 'toResponse() resolves before end() and body streams each write incrementally (SSE invariant)': `res.writeHead(200,{'content-type':'text/event-stream'}); res.write('data: a\n\n'); const response = await res.toResponse();` first read === `'data: a\n\n'`, `res.writableEnded === false`; `res.write('data: b\n\n')`, second read === `'data: b\n\n'`. FAILS if any code buffers to end.
   - **Files:** `packages/net/src/http/response.test.ts`

3. **T3 — Lock the SW→page body-carrier behavior SSE rides on.** [unit]
   `packSerializedResponse` transfers a ReadableStream zero-copy (non-empty transfer list) when `canTransferReadableStream()`, drains to `Uint8Array` otherwise. Make the SSE consequence explicit: the drain fallback buffers an unending stream — so the no-transferable-stream realm is the documented SSE ceiling, not the streaming path.
   - **Failing test first:** body-transport.test.ts add 'packSerializedResponse transfers a live ReadableStream (SSE fast path) and drains otherwise': with `canTransferReadableStream()===true`, pack a Response backed by a never-ending stream; assert `result.transfer.length===1` and `result.message.body` is the SAME ReadableStream instance (NOT drained — proves no block on an unending body). Then stub the unsupported branch with a FINITE stream; assert `result.transfer.length===0` and `result.message.body instanceof Uint8Array`. FAILS if the fast path is missing or pack awaits an unending stream.
   - **Files:** `packages/service-worker/src/body-transport.test.ts`

4. **T4 — Confirm route-preview reconstruction keeps the live stream.** [conformance]
   `routePreview` rebuilds `new Response(raw,…)` from the transferred ReadableStream (route-preview.ts:131) without draining, so an SSE body stays incremental SW→page. Add a regression driving a SerializedResponse whose body is a live ReadableStream, asserting the reconstructed Response yields a chunk before the source closes. Update compat-matrix: SSE/event-stream over page-direct preview bridge = supported; over Worker path = buffered/not-streaming until v3 (T5-7); PTY-connect WebSocket = not-supported (hard blocker).
   - **Failing test first:** route-preview.test.ts add 'reconstructs a live ReadableStream Response without draining (SSE SW→page)': drive routePreview with a fake binding/client whose reply posts a SerializedResponse `{status:200, headers:{'content-type':'text/event-stream'}, body: <live ReadableStream: one frame then stays open>}`; assert returned content-type is text/event-stream and `reader.read()` yields the first `data:` frame while the source controller is open (`done===false`). FAILS if routePreview drains/buffers the body.
   - **Files:** `packages/service-worker/src/route-preview.test.ts`, `docs/compat/`

5. **T5 — BLOCKED ON ADR #2. V3 page-side incremental reassembly.** [conformance]
   Bump PREVIEW_PORT_FRAME_VERSION 2→3; make bridgeCrossRealmPreview resolve the Response on reply-stream-start from a live ReadableStream whose controller enqueues each reply-stream-chunk and closes on reply-stream-end. Existing v2 buffered tests stay green (negotiated fallback). Do NOT modify v2 streaming tests; add a v3 suite alongside (CLAUDE.md: never modify a test to make code pass).
   - **Failing test first:** preview-port.test.ts add suite 'preview port v3 — incremental SSE': using rawWorker, post start→chunk(seq0)→[pause]→chunk(seq1)→…(never end); assert the page Response RESOLVES on reply-stream-start (before any chunk) with start headers, and `response.body.getReader()` yields chunk0 bytes BEFORE chunk1 is posted (incremental, not reassembled-on-end). Pin `v==='3'` on the request frame the worker receives. FAILS under v2 (resolves only on reply-stream-end).
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`, `docs/adr/`

6. **T6 — BLOCKED ON ADR #2. Re-spec the no-progress idle timer for never-ending v3 streams; surface mid-stream worker death as a stream ERROR.** [conformance]
   `controller.error` rather than a buffered 502 (the Response is already handed to the consumer). Timer re-arms on every chunk and tolerates SSE keep-alive comments (`:\n`); a worker silent for >timeoutMs after start errors the live stream.
   - **Failing test first:** preview-port.test.ts (v3 suite) add 'v3 idle timer: live SSE keep-alive never reaps; silent worker errors the handed-out stream': (a) rawWorker posts start then a keep-alive comment chunk every <timeoutMs for longer than timeoutMs total — reader keeps yielding (no error); (b) rawWorker posts start + chunk0 then goes silent — assert Response already resolved AND `reader.read()` REJECTS (stream errored) after ~timeoutMs, NOT a fresh 502 Response. FAILS under v2 (502 instead of erroring an open stream; timer reaps the live stream).
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`

7. **T7 — BLOCKED ON ADR #2. Version negotiation across the v3 bump.** [conformance]
   A v3 page against a v2 worker still works via the buffered `reply` fast path; a v2 page against a v3 worker negotiates the buffered fallback or 503s per the existing mismatch contract (preview-port.ts:360-368). Mirror existing SW_FRAME_VERSION mismatch tests. Keep byte-faithful MAX_CHUNK_BYTES splitting and add the Q-2026-05-30-070 TODO(ADR): one SSE event MAY span multiple 64KiB chunks, so the consumer must not treat a chunk boundary as an event boundary.
   - **Failing test first:** preview-port.test.ts (v3 suite) add 'negotiation: v3 page <-> v2 worker buffers; v2 frame against v3 page -> 503': (a) rawWorker replying buffered `reply` (no v or `v='2'`) against a v3 bridge resolves a correct buffered Response; (b) rawWorker posts reply-stream-start with `v='2'` to a v3 page → 503 + `console.error(expected:'3', got:'2')`. Plus 'an SSE event split across two 64KiB chunks reassembles into one event for a byte-fed consumer'. FAILS until v3 negotiation + boundary note exist.
   - **Files:** `packages/net/src/cross-realm/preview-port.ts`, `packages/net/src/cross-realm/preview-port.test.ts`, `OPEN_QUESTIONS.md`

### Scaffolding sketch

```ts
// ── P4 SHIP PATH (page-direct) — NO new public symbol. Only proves + locks existing behavior. ──

// packages/net/src/http/response.ts  (EXISTING — no signature change)
//   toResponse(): Promise<Response>   resolves at flushHeaders() (response.ts:123,224) — confirmed
//   write(chunk): boolean | Promise<boolean>  — enqueues live, never buffers to end()
// SSE proof asserts toResponse() resolves BEFORE end(), and Response.body yields each
// `data: ...\n\n` frame incrementally as write() is called. No code change expected;
// if a test reveals buffering, the fix is local to response.ts (still no API change).

// packages/service-worker/src/body-transport.ts (EXISTING — no signature change)
//   packSerializedResponse(resp): Promise<{message, transfer}>  — transfer non-empty for a
//   ReadableStream when canTransferReadableStream(); drains to Uint8Array fallback otherwise.
// SSE relies on the transfer (zero-copy) path. The fallback DRAINS — buffering an
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
//   long-lived SSE stream mid keep-alive.

// serveCrossRealmPreview: UNCHANGED (already emits start→chunks→end; preview-port.ts:208-255).

// Negotiation: page stamps v='3' on `request`; a v2 worker still replies buffered `reply` (works);
//   a v2 page against a v3 worker validates v on reply-stream-start and 503s (existing path,
//   preview-port.ts:360-368) — mismatch contract reused, not reinvented.

// NOT INTRODUCED: no `ws` shim for /event. BridgedWebSocket* (ws/bridge.ts) untouched.
// PTY-connect route stays a throw-on-connect stub (hard blocker).
```

### Risks

- The P4 ship rests on T1's opencode harness, which depends on features 05/06/08. **Make-or-break unknown #1:** if 06 can't boot the server programmatically (HttpApiApp.createRoutes statically importing the storage/Database layer trips bun:sqlite at layer-build time), T1 can't run and the SSE claim is unproven. Sequence T1 AFTER 06 lands, not in parallel.
- **Make-or-break unknown #2** (IncomingMessage/ServerResponse shapes fully reproducible over the bridge): if Effect's `HttpServerResponse.stream` depends on a ServerResponse surface rifty doesn't reproduce (flushHeaders timing, or a write() return-type assumption — rifty widens write() to `boolean|Promise<boolean>`, response.ts:160), SSE may stall at the source. T2 pins the rifty side but not Effect's expectations; T1 parity is the only place that surfaces it.
- The drain fallback in `packSerializedResponse` (body-transport.ts:68) HANGS FOREVER on an unending SSE body in a realm without transferable streams (older Safari/some Workers). T3 documents this ceiling, but a real deployment landing there delivers SSE never, silently. The compat-matrix note (T4) must be loud; consider a guard refusing to drain a `text/event-stream` body rather than hanging — but that guard is itself a behavior change needing its own ticket (do not bundle).
- **V3 idle-timer re-spec (T6) is highest-blast-radius:** getting it wrong reaps live event streams. The timer must distinguish a legitimately-idle long-lived SSE stream from a dead worker — the chosen rule (re-arm on every chunk incl keep-alive `:\n`, reap only on silence past timeoutMs) must be encoded as an explicit test (T6a/b) BEFORE implementation; v2 idle tests stay untouched.
- V3 changes resolution from resolve-on-end to resolve-on-start: any current page-side consumer assuming the Response is fully buffered when it resolves (e.g. `.arrayBuffer()` expecting completeness) breaks. The bump is gated behind negotiation (T7), but in-repo callers of bridgeCrossRealmPreview must be audited before T5 ships — an unaudited caller is a silent regression.
- **Scope creep:** the name says "ws-sse-bridge". The design correctly reclassifies /event as SSE-over-HTTP and refuses a ws shim, but a reviewer may push to bridge PTY-connect too. That is a hard blocker (native PTY) and must stay a throw-on-connect stub; touching it inverts the feasibility verdict.

### Estimate

- P4 ship path (T1–T4): ~3 evenings (T1 harness fork is the bulk; T2/T3 unit locks ~1; T4 doc/compat ~0.5).
- V3 spec path (T5–T7), only after ADR #2 ratifies: ~4 evenings (conformance round-trip + idle-timer re-spec + negotiation/mismatch + e2e deferred to playwright).
- Total ~7 evening-units, 4 gated.

### Ratification gate

**BLOCKED-IN-PART.** Two design decisions are needsHumanRatification and IRREVERSIBLE:

1. ADR-00NN "opencode event stream rides SSE-over-streaming-HTTP on the preview bridge; no `ws` shim (PTY-connect WS stays stubbed)" — rules OUT a ws shim and pins SSE=streaming-HTTP across packages/net + packages/service-worker (rule 1, proximity to ADR-0048 scope). The page-direct IMPLEMENTATION needs no new code, so T1–T4 (P4 ship + unit locks + ceiling doc) may proceed under the recommended decision; this ADR must be RATIFIED before merge, not before work.

2. ADR-00NN "PREVIEW_PORT_FRAME_VERSION 3 — incremental never-ending SSE over the page↔Worker bridge; idle-timer re-spec" — bumps a versioned wire contract governed by ADR-0048/ADR-0040 and edits >100 lines across page+worker paths (rules 3, 4). T5–T7 are HARD-BLOCKED: do not write or ship the v3 bump until this ADR ratifies. They are specified so the failing tests exist, but must not be committed pre-ratification (CLAUDE.md: IRREVERSIBLE decisions must not be invented).

**Net:** T1–T4 proceed now (merge-gated on ADR #1). T5–T7 fully blocked on ADR #2. Q-2026-05-30-070 (chunk-vs-event-boundary note) is REVERSIBLE — log + TODO(ADR), no gate.
