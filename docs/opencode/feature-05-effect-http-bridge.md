# Feature 05-effect-http-bridge — node:http createServer -> SW/port-registry bridge for @effect/platform-node

> Part of the opencode-in-rifty facade effort. Feasibility phase P1. Staged doc — NOT a ratified ADR.

## Summary

Map `@effect/platform-node`'s `NodeHttpServer.layer` onto rifty's existing port-registry + SW bridge by making rifty's `node:http.createServer().listen(options)` consume the way Effect drives it. De-risk finding `unknown-2` is **CONFIRMED reproducible-with-adapter**:

- The **REQUEST side** (IncomingMessage pull-stream contract: `read(n)`/`'readable'`/`'end'`/`'error'`/`'off'`/`'destroy'`, plus `headers`/`socket.remoteAddress`/`url`/`method`) is already satisfied **AS-IS** by `packages/net/src/http/request.ts:69-83` over `@rifty/io` Readable — no change needed, same as the express@4 precedent.
- The **RESPONSE side** needs a **THIN, ADDITIVE adapter** on `packages/net/src/http/response.ts` for two gaps Effect's `httpServer.ts` exercises:
  1. it parks on a Node-style `'drain'` event during its streaming write loop and ignores `write()`'s boolean/Promise return, so streaming responses hang today;
  2. it uses `Readable.fromWeb(webStream).pipe(nodeResponse)` for FormData/stream bodies, but `ServerResponse` is an `EventEmitter`, not a `Writable` `.pipe()` sink.
- There is ALSO a small `listen()` signature gap: `HttpServer.listen` takes a bare number (`server.ts:27`) but Effect calls `server.listen({ port, host }, cb)` with an options object.

For the **P3 first-light** target (a buffered `res.writeHead` + `res.end(jsonBody)` status/version route) NONE of the streaming gaps bite — only the `listen(options)` overload is needed — so P3 boots with the smallest change. The streaming + pipe-sink adapter is required before **P4** (LLM round-trip likely streams).

The SW/cross-realm bridge itself is **handler-shape-agnostic** (it carries port + headers + body bytes per ADR-0040/0048), so it does not care that the handler is Effect vs express; **no bridge-protocol change**.

This feature is the `createServer -> listen -> registerPort` consumption layer ONLY; it does **NOT** design WS/SSE upgrade (`assignSocket` / `server.on('upgrade')`) which is hard-blocker-adjacent and owned by **feature 07**.

## Decisions (classified)

### Decision Q-101 — `listen()` options-object overload

- **Question:** Effect calls `server.listen({ port, host }, cb)` with an OPTIONS OBJECT, but rifty `HttpServer.listen` (`server.ts:27`) only accepts a bare number as first arg. How do we make `listen()` accept Node's options-object overload so Effect's `NodeHttpServer.layer` can register a port?
- **Classification:** REVERSIBLE
- **Chosen:** Widen `HttpServer.listen` to accept Node's full overload set: `listen(port|options, hostOrCb?, cb?)` where `options` is `{ port?: number; host?: string; ... }`. Extract the numeric port from either form, keep the existing bare-number path 100% unchanged, ignore `host` (loopback-only model already, `request.ts:28-38`). This is additive within the single file `packages/net/src/http/server.ts`, no signature is removed, no cross-package type is exported (the `listen` signature is on the `HttpServer` class already exported, but we only WIDEN an existing public method's accepted inputs, not add a new export). Provisional; mark `TODO(ADR)`.
- **Alternatives:**
  - (a) Add a separate Effect-only adapter export in `packages/net` (e.g. `effectHttpServer()`) that wraps `createServer` and normalises `listen` — REJECTED: adds NEW cross-package public API surface => IRREVERSIBLE rule 1, heavier, and the seam map warns this is exactly the IRREVERSIBLE trigger for this feature.
  - (b) Shim `listen` via shadow-registry override on `@effect/platform-node`'s `NodeHttpServer` call site — REJECTED: brittle, couples to Effect internals, and rifty's own http should accept the standard Node options form anyway (Node's real `http.Server.listen` accepts an options object, so this is a genuine parity gap, not an Effect-specific hack).
  - (c) Pre-resolver module-loader hook to rewrite the call — over-engineered.
- **Trade-offs:** Widening `listen()` is the most Node-faithful fix and benefits all consumers, not just Effect; risk is near-zero because we only add accepted input shapes. It does technically change the accepted-input contract of an exported class method, but it is purely additive (every existing caller still compiles and behaves identically) and reverting is <20 lines in 1 file => REVERSIBLE rule 4. Trade-off vs the adapter-export option: we avoid new public API but the change lives in the shared net package rather than being isolated to Effect concerns.
- **Reversibility justification:** Single file (`packages/net/src/http/server.ts`), additive widening of an existing method's input, <100 lines, no NEW exported symbol, no ADR conflict, no new dep. First 'yes' in checklist is rule 4 -> NO (revert <100 lines/1 file) => REVERSIBLE.
- **Proposed Q-id:** `Q-2026-05-30-101`

### Decision Q-102 — Node-style `'drain'` emission for streaming backpressure

- **Question:** Effect's streaming write loop in platform-node `internal/httpServer.ts` parks on `nodeResponse.on('drain', ...)` and IGNORES `write()`'s return value, but rifty `ServerResponse` (`response.ts:160-183`) signals backpressure ONLY via a `boolean|Promise<boolean>` return and NEVER emits a Node `'drain'` event. Streaming responses hang. How do we close this?
- **Classification:** REVERSIBLE
- **Chosen:** Make `ServerResponse` emit a Node-style `'drain'` event when the internal `ReadableStream` `pull()` fires and the queue has room again. The `pull`/`pendingPulls` machinery already exists at `response.ts:53-65`; add `this.emit('drain')` inside the pull callback (after draining `pendingPulls`). Keep `write()`'s `boolean|Promise` return as-is for existing rifty/express callers (purely additive: an extra event, no behavior removed). To make the boolean path align with Node, optionally have `write()` return raw `false` (not the Promise) when backpressured AND ensure a later `'drain'` fires — but the minimal, safe change is just emitting `'drain'` on pull; Effect only needs the event, it ignores the return. Provisional; mark `TODO(ADR)`.
- **Alternatives:**
  - (a) Patch `@effect/platform-node` via shadow-registry to await `write()`'s Promise instead of parking on `'drain'` — REJECTED: couples to Effect internals, fragile across Effect beta versions (`4.0.0-beta.66` pinned), and the seam map's bridge-agnostic principle says fix rifty's Node shape, not the consumer.
  - (b) Buffer the whole response and never stream — REJECTED: defeats P4 LLM streaming, and the cross-realm page side already reassembles buffered (ADR-0048) so memory blows up on long generations.
  - (c) Do nothing for P3, defer to P4 — partially adopted: P3 (buffered `end(body)`) does NOT need `'drain'`, so this decision is only GATING for P4; for P3 it's a no-op.
- **Trade-offs:** Emitting `'drain'` is the standard Node Writable contract and is what every Node http consumer (not just Effect) expects, so it improves general parity. Risk: a stray `'drain'` listener in some other consumer could now fire — but rifty's own callers don't listen for it today, so additive-only. Confined to `packages/net/src/http/response.ts`, <30 lines.
- **Reversibility justification:** Single file, additive (new event emission), <100 lines, no new export, no new dep, no ADR conflict. REVERSIBLE rule 4 -> NO => REVERSIBLE.
- **Proposed Q-id:** `Q-2026-05-30-102`

### Decision Q-103 — Writable-sink duck shape so `.pipe(res)` works

- **Question:** Effect's `internal/httpServer.ts` uses `Readable.fromWeb(body).pipe(nodeResponse)` for FormData/web-stream response bodies, but rifty `ServerResponse` is an `EventEmitter`, not a `Writable` `.pipe()` sink, so `.pipe(res)` has no destination. How do we make `ServerResponse` a valid pipe target?
- **Classification:** REVERSIBLE
- **Chosen:** Add the minimal Writable-sink duck shape to `ServerResponse` so `Readable.fromWeb(stream).pipe(res)` works: it already has `write()` (returns `boolean|Promise<boolean>`), `end()`, and (after Q-101/Q-102) emits `'drain'`; add a defensive `once('error', ...)`/`on('error')` no-op-or-destroy path and verify `@rifty/io` `Readable.pipe()` drives a target via `{write, end, on('drain'), once('error')}` (`request.ts` uses `@rifty/io` Readable; confirm its `pipe()` contract against this duck shape before finalizing). If `@rifty/io` `Readable.pipe` expects a stricter `Writable`, prefer Effect's other documented path (it falls back to chunked write loop for non-FormData bodies) and scope pipe-sink to FormData responses only — opencode's facade serve path emits JSON/SSE, not FormData, so this may be **P5-deferrable**. Provisional; mark `TODO(ADR)`.
- **Alternatives:**
  - (a) Make `ServerResponse` extend `@rifty/io` `Writable` instead of `EventEmitter` — REJECTED for now: larger change, risks the existing `ReadableStream`-controller body model (`response.ts:49-66`) and the express-proven shape; would likely exceed the <100-line/2-file REVERSIBLE bound and touch the body machinery => could flip IRREVERSIBLE.
  - (b) Convert web-stream bodies to chunked `write()` loop at the bridge so `.pipe` is never reached — possible but Effect chooses `.pipe` internally; we'd have to patch Effect (rejected, coupling).
  - (c) Defer entirely: opencode facade likely never sends FormData/web-stream response bodies (it sends JSON + SSE), so mark pipe-sink as a known gap behind a parity test and revisit if a real route needs it.
- **Trade-offs:** Adding the duck shape is cheap IF `@rifty/io` `Readable.pipe` accepts it; if not, the safe call is to DEFER (option c) and document the gap, because the facade's actual routes don't need FormData responses. Keeping `ServerResponse` as `EventEmitter` + duck methods avoids destabilizing the proven streaming body. Risk: SSE for the LLM round-trip (feature 08) might route through a stream body; but SSE-over-bridge is itself an unsolved item (seam map: no WebSocket/SSE bridge) owned by feature 07, so this decision must NOT pre-empt it.
- **Reversibility justification:** Additive duck-typed methods on one file (`response.ts`), <100 lines, no new export/dep, no ADR conflict, AND explicitly bounded to stay reversible (if it would require extending `Writable` / touching body machinery, we defer instead). REVERSIBLE rule 4 -> NO => REVERSIBLE.
- **Proposed Q-id:** `Q-2026-05-30-103`

### Decision Q-104 — AS-IS consumption vs dedicated Effect adapter export

- **Question:** Should rifty register a distinct Effect adapter layer (a new exported symbol in `packages/net`) so `@effect/platform-node` consumes a rifty-specific `NodeHttpServer`, OR should Effect consume the existing `node:http.createServer` AS-IS?
- **Classification:** **IRREVERSIBLE**

> **⚠️ WARNING — IRREVERSIBLE / NEEDS HUMAN RATIFICATION.** This decision is an architecturally load-bearing fork that touches cross-package public API. Do NOT begin implementation that depends on this choice until the ADR below is ratified. Per CLAUDE.md, IRREVERSIBLE choices must NOT be invented.

- **Chosen:** **RECOMMENDED — awaiting ratification (not final):** Effect consumes the EXISTING `node:http` builtin AS-IS — **NO** new exported Effect adapter symbol in `packages/net`. The de-risk finding shows Effect only touches `createServer()` (no-handler form, then `server.on('request')` — rifty emits `'request'` at `server.ts:36`), `server.listen(options)`, and the `IncomingMessage`/`ServerResponse` duck shapes already covered by Q-101/102/103. Therefore the bridge work is entirely WIDENING the existing `node:http` surface (the three REVERSIBLE decisions above), with ZERO new cross-package public API. This keeps the feature on the REVERSIBLE side of the seam map's stated IRREVERSIBLE trigger.
- **Alternatives:**
  - (a) **RECOMMENDED above:** no new export; widen existing `node:http`. Trade-off: changes the shared http shape (but each change is independently Node-parity-justified and additive).
  - (b) Add a `packages/net` export `createEffectHttpServer()` / a `NodeHttpServer`-shaped adapter that Effect's layer binds to — this is the IRREVERSIBLE path: NEW cross-package public API (checklist rule 1). Trade-off: isolates Effect concerns from the shared http module, but commits `packages/net` to an Effect-coupled public symbol forever and pulls Effect into the net layer's API contract.
  - (c) Provide the adapter from a HIGHER layer (e.g. the opencode headless harness / tools), not `packages/net` — avoids net public-API growth while isolating Effect; trade-off: the harness must reach into Effect's `NodeHttpServer` factory injection, more coupling to Effect internals.
- **Trade-offs:** Option (a) is cleanest and is what the evidence supports (Effect needs nothing beyond standard Node http shapes), but it does evolve the shared http surface. Option (b) draws a clean Effect/net boundary at the cost of a permanent IRREVERSIBLE public API and reverse-direction coupling (net knowing about Effect). The decision is IRREVERSIBLE ONLY because choosing (b)/(c) would add cross-package public API; choosing (a) is itself reversible — but the CHOICE BETWEEN them is architecturally load-bearing and must be ratified, because once a public Effect adapter ships it cannot be quietly removed.
- **Reversibility justification:** Checklist rule 1 (touches public API between packages) is the gating concern: any adapter-export option (b/c) WOULD add cross-package public API => IRREVERSIBLE. The recommended option (a) avoids that, but selecting the overall strategy is the irreversible architectural fork and needs human ratification per the seam map's explicit warning that adding a `packages/net` Effect adapter is the IRREVERSIBLE trigger for THIS feature.
- **Proposed ADR title:** `ADR-00NN: Effect @effect/platform-node consumes rifty node:http AS-IS via additive shape-widening (no dedicated cross-package Effect HTTP adapter)`

## Interface contract

No NEW exported symbols (recommended path). Changes are additive WIDENING of the already-exported `node:http` surface in `packages/net`:

```ts
// packages/net/src/http/server.ts — listen() overload widened (Q-101)
interface ListenOptions { port?: number; host?: string; backlog?: number; exclusive?: boolean }
class HttpServer extends EventEmitter {
  // before: listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this
  // after (additive):
  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this
  listen(options: ListenOptions, cb?: () => void): this
  // still: emits 'request'(req, res), 'listening', 'close'; createServer() with no handler is valid (Effect attaches via .on('request'))
}

// packages/net/src/http/response.ts — additive event + duck-sink (Q-102, Q-103)
class ServerResponse extends EventEmitter {
  // unchanged: statusCode, statusMessage, setHeader, getHeader, removeHeader, writeHead, write(): boolean|Promise<boolean>, end(), get headersSent, get writableEnded, toResponse(), 'finish'
  // ADDED: emits 'drain' when internal ReadableStream pull() fires with room (Q-102)
  // ADDED (Q-103, conditional on @rifty/io Readable.pipe contract): valid Writable-sink duck shape so Readable.fromWeb(stream).pipe(res) works; otherwise pipe-sink DEFERRED and documented as a gap
}
```

Consumption shape Effect relies on (already present, asserted by parity tests): `IncomingMessage { method, url(pathname+search), headers(lowercased), httpVersion='1.1', socket.remoteAddress='127.0.0.1', extends @rifty/io Readable implementing read(n)/'readable'/'end'/'error'/off()/destroy() }` (`request.ts:69-83`). Port registration unchanged: `registerPort(port, (Request)=>Promise<Response>)` (`server.ts:32`). Bridge protocol UNCHANGED (ADR-0040 `SW_FRAME`/`ROUTING`, ADR-0048 preview-port frame) — handler-shape-agnostic, no version bump.

## Affected packages & seams

**Affected packages:**

- `packages/net`

**Seam anchors:**

- `packages/net/src/http/server.ts:27`
- `packages/net/src/http/server.ts:32`
- `packages/net/src/http/server.ts:36`
- `packages/net/src/http/server.ts:63`
- `packages/net/src/http/response.ts:53`
- `packages/net/src/http/response.ts:160`
- `packages/net/src/http/response.ts:185`
- `packages/net/src/http/request.ts:69`
- `packages/net/src/register-builtins.ts:15`
- `packages/net/src/registry.ts:1`
- `packages/net/src/cross-realm/preview-port.ts:49`

## Dependencies

**Depends on:**

- `02-ts-on-import-graph`
- `04-db-and-pty-shims`

**Blocker proximity:** CLOSE to two HARD BLOCKERS, stays on the feasible side by explicit scoping.

1. **WebSocket/SSE upgrade:** Effect's `httpServer.ts` uses `assignSocket` + `server.on('upgrade')` for websocket upgrade; the seam map confirms rifty has NO WebSocket/SSE bridge and the cross-realm path is HTTP-only (`preview-port.ts` is request/reply). This feature DELIBERATELY excludes `upgrade`/`assignSocket` — it is owned by **feature 07-ws-sse-bridge**. We design TO this boundary: the bridge carries buffered + chunked HTTP only; a streaming SSE response for the LLM round-trip (feature 08) is the FIRST thing that will press against this and is explicitly NOT solved here.
2. **Streaming response `'drain'`/`pipe` gaps (Q-102/Q-103):** sit right at the edge of what the buffered cross-realm page side can do (ADR-0048: page reassembles buffered, no true cross-realm backpressure until M12/ADR-0017) — so even with `'drain'` emitting correctly server-side, end-to-end streaming through the SW bridge is bounded by the existing buffered-reassembly ceiling, not by this feature.

We stay feasible by targeting **P3** (pure buffered `end(body)`) for first light, where NONE of the streaming/upgrade blockers bite, and flagging streaming as gated work. No process-spawn / PTY / native-SQLite blocker is touched by this feature at all (those are features 03/04 and the tool-execution ceiling in 09).

## Test strategy

Parity is the gold standard here and is achievable because the contract is Node-http behavior. Levels:

1. **PARITY (primary, for P3 first-light):** a parity-runner case where the SAME handler (`createServer` with no handler + `server.on('request', (req,res)=>{ res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({version:'x'})) })`) runs under (a) real Node http and (b) rifty `node:http` via `registerPort`+`dispatchToPort`, diffing status line + headers + body bytes. This directly proves the `listen(options)` overload (Q-101) and the buffered `end(body)` path with ZERO streaming.
2. **PARITY (streaming, gates P4):** drive a chunked streaming response and assert (a) the `'drain'` event fires after backpressure (Q-102) under both Node and rifty, and (b) ordered chunk delivery matches Node. Use the existing `response.test.ts` backpressure harness as the base (`response.ts:160-183` `pendingPulls` machinery).
3. **UNIT (Q-103 pipe-sink):** a focused unit test that `Readable.fromWeb(webStream).pipe(res)` terminates and produces the right bytes IF `@rifty/io` `Readable.pipe` accepts the duck shape; if not, an xfail/skip documenting the deferred gap.
4. **INTEGRATION (headless harness, the real proof):** fork `tests/integration/fixtures/real-vite-smoke.ts` into an `opencode-effect-http-smoke` harness that builds ONLY `NodeHttpServer.layer` over a trivial Effect `HttpRouter` (one `/version` route) — NOT the full opencode layer set (that depends on features 03/04/06) — `server.listen` via the bridge, then fetch `/version` through `dispatchToPort` and assert 200 JSON. This isolates the bridge from the `#db`/`#pty` blockers so feature 05 can be validated independently of 06.
5. **NEGATIVE:** assert `server.on('upgrade')` / `assignSocket` path is NOT exercised (websocket/SSE upgrade is out of scope, owned by feature 07) — a test that an upgrade attempt throws/no-ops cleanly rather than silently corrupting the buffered path.

## Implementation plan (test-first)

> Feature: `05-effect-http-bridge — node:http createServer -> SW/port-registry bridge for @effect/platform-node (feasibility P1)`

1. **T1 — Q-101 `listen(options)` overload [unit].** Widen `HttpServer.listen` to accept Node's options-object overload `listen({port,host}, cb)` while keeping the bare-number path byte-for-byte identical. Extract numeric port from either form; ignore `host` (loopback-only). Mark `TODO(ADR): Q-2026-05-30-101`. Log `Q-2026-05-30-101` in `OPEN_QUESTIONS.md`.
   - **FAILING test first:** In `packages/net/src/http/server.test.ts` (NEW file): test `'listen(options) registers the port and fires listening'` — `const s = createServer(); let listened=false; s.on('listening',()=>{listened=true}); s.listen({ port: 4097 }, ()=>{}); await microtask; expect(listPorts()).toContain(4097); expect(listened).toBe(true)`. MUST FAIL today (current `listen(port:number,...)` coerces the options object: port becomes the object, `registerPort` key is wrong / `NaN`).
   - **Files:** `packages/net/src/http/server.test.ts`, `packages/net/src/http/server.ts`, `OPEN_QUESTIONS.md`
2. **T2 — P3 first-light buffered proof [unit].** A buffered `createServer` (no-handler form + `server.on('request', (req,res)=>{ res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({version:'x'})) })`) registered via `listen`, dispatched through `dispatchToPort`, returns 200 with correct content-type and exact JSON body bytes. This is the Effect-shaped consumption: `createServer()` with NO handler, then `.on('request')`. Proves the existing `emit('request')` path (`server.ts:36`) plus the buffered `end(body)` path needs NONE of the streaming gaps.
   - **FAILING test first:** In `packages/net/src/http/server.test.ts`: test `'no-handler createServer + on(request) buffered end(body) dispatches 200 JSON'` — register on port, `const resp = await dispatchToPort(port, new Request('http://preview.local:'+port+'/version')); expect(resp.status).toBe(200); expect(resp.headers.get('content-type')).toBe('application/json'); expect(await resp.text()).toBe(JSON.stringify({version:'x'}))`. MUST FAIL until T1 lands (listen of the registering port) AND confirms the request-emit path works for the no-arg-constructor Effect form.
   - **Files:** `packages/net/src/http/server.test.ts`
3. **T3 — Q-102 gated `'drain'` emission [unit].** `ServerResponse` emits a Node-style `'drain'` event when the internal `ReadableStream` `pull()` fires after a backpressured write, WITHOUT firing spurious `'drain'` before any backpressure. Add a `_needDrain` gate set in `write()` when it returns the backpressure Promise; `emit('drain')` in `pull()` only when gated. Keep `write()`'s `boolean|Promise` return unchanged (additive). Mark `TODO(ADR): Q-2026-05-30-102`. Log `Q-2026-05-30-102`.
   - **FAILING test first:** In `packages/net/src/http/response.test.ts` (extend existing backpressure suite): test `'emits drain after backpressured write resolves on pull()'` — `writeHead`+`write` fills HWM=1 queue; issue a 2nd write (backpressured); attach `res.on('drain', ...)`; start reading the response body; assert the `'drain'` listener fired AFTER the reader pulled, exactly once. AND a negative assertion: `'does NOT emit drain when no write was backpressured'` (a single small write + read => zero `'drain'` events). Both MUST FAIL today (`ServerResponse` never emits `'drain'`).
   - **Files:** `packages/net/src/http/response.test.ts`, `packages/net/src/http/response.ts`, `OPEN_QUESTIONS.md`
4. **T4 — Q-103 pipe-sink duck shape [unit].** Make `Readable.from(asyncIterable).pipe(res)` terminate and deliver correct bytes into `ServerResponse`, driven by `@rifty/io` `Readable.pipe` (`readable.ts:488`). Widen `PipeableWritable.write` return type in `readable.ts` to `boolean|Promise<boolean>` (one-line, lower-layer, additive) so `ServerResponse` is structurally assignable. Add `ServerResponse` defensive `'error'` handling so a source error destroys the body stream rather than going unhandled. Mark `TODO(ADR): Q-2026-05-30-103`. Log `Q-2026-05-30-103`. DOCUMENT in the test header that Effect's actual entry is `Readable.fromWeb(webStream).pipe(res)`, and `@rifty/io.Readable` has NO static `fromWeb` — this task only proves `ServerResponse` is a valid pipe TARGET; `fromWeb` is an out-of-scope/deferred gap (note in compat-matrix as the Effect web-stream-response path being unsupported until `fromWeb` lands).
   - **FAILING test first:** In `packages/net/src/http/response.test.ts`: test `'Readable source pipes into ServerResponse and produces ordered bytes'` — `const src = Readable.from(['a','b','c']); const res = new ServerResponse(); res.writeHead(200,{}); src.pipe(res); const resp = await res.toResponse(); expect(await resp.text()).toBe('abc')` AND res `'finish'` fires. MUST FAIL today: TS-level `PipeableWritable.write` mismatch and/or no `end()` chaining wired through pipe — confirm the failure is real before the fix.
   - **Files:** `packages/net/src/http/response.test.ts`, `packages/net/src/http/response.ts`, `packages/io/src/streams/readable.ts`, `OPEN_QUESTIONS.md`
5. **T5 — NEGATIVE / feature-07 boundary lock [unit].** Assert this feature does NOT silently absorb a WebSocket/SSE upgrade into the buffered HTTP path. Effect uses `server.on('upgrade')` + `assignSocket` for upgrades; rifty `HttpServer` has no upgrade/assignSocket support. The test must prove that an upgrade attempt either no-ops cleanly (no `'request'` emit, no corrupted buffered Response) or is observably absent — NOT silently routed as a normal request. This protects feature 08 (SSE LLM round-trip) from a silent-corruption regression.
   - **FAILING test first:** In `packages/net/src/http/server.test.ts`: test `'upgrade path is not silently consumed as a normal request'` — register a server; assert `HttpServer` does NOT emit `'request'` for an upgrade-style invocation AND that no `assignSocket` method exists (or that calling it throws `NotImplementedError` rather than corrupting). Concretely: assert `('assignSocket' in res) === false` and that the server exposes no `'upgrade'` handling that mis-routes. MUST FAIL only if someone later wires a fake upgrade path; today it documents the intentional gap (register feature-07-owned upgrade as compat-matrix ❌).
   - **Files:** `packages/net/src/http/server.test.ts`
6. **T6 — Integration harness, the real bridge proof [integration].** Fork of `tests/integration/fixtures/real-vite-smoke.ts`: build ONLY `@effect/platform-node` `NodeHttpServer.layer` over a trivial Effect `HttpRouter` with one `/version` route, `server.listen({port})` through the port registry, then `dispatchToPort` a Request and assert 200 JSON. Does NOT build the full opencode layer set (depends on features 03/04/06). Pin the `@effect/platform-node` version in the fixture. Sandbox-disabled (live npm). **BLOCKED until ratification gate clears AND features 02 (TS-on-import) + 04 (`#db`/`#pty` shims) land** — without them the Effect module graph trips `bun:sqlite` at import.
   - **FAILING test first:** New fixture `tests/integration/fixtures/opencode-effect-http-smoke.ts` asserts: after building `NodeHttpServer.layer` + a one-route `HttpRouter` and `listen({port:4096})`, `const resp = await dispatchToPort(4096, new Request('http://preview.local:4096/version')); assert resp.status===200 && (await resp.json()).version` then print `RIFTY_OPENCODE_HTTP_SMOKE_OK`. Driven by a vitest integration spec that runs the fixture under tsx and greps stdout for the OK marker (mirroring the real-vite-smoke harness). MUST FAIL until T1-T4 land (listen options + buffered/streaming response shapes) AND deps 02/04 land.
   - **Files:** `tests/integration/fixtures/opencode-effect-http-smoke.ts`, `tests/integration/effect-http-smoke.test.ts`

### Scaffolding sketch

```ts
// === packages/net/src/http/server.ts — Q-101 listen() overload widening (ADDITIVE) ===
// Add an exported options interface (local, not re-exported cross-package unless needed):
interface ListenOptions { port?: number; host?: string; backlog?: number; exclusive?: boolean }

class HttpServer extends EventEmitter {
  // EXISTING bare-number overload kept verbatim:
  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this;
  // NEW additive overload Effect calls: server.listen({ port, host }, cb)
  listen(options: ListenOptions, cb?: () => void): this;
  // single impl normalises:
  listen(portOrOptions: number | ListenOptions, hostOrCb?: string | (() => void), cb?: () => void): this {
    const port = typeof portOrOptions === 'number' ? portOrOptions : (portOrOptions.port ?? 0);
    const callback =
      typeof portOrOptions === 'number'
        ? (typeof hostOrCb === 'function' ? hostOrCb : cb)
        : (typeof hostOrCb === 'function' ? hostOrCb : cb); // options form: hostOrCb IS the cb
    // ...existing registerPort(port, ...) body unchanged; host ignored (loopback-only model)
  }
}

// === packages/net/src/http/response.ts — Q-102 'drain' emission (ADDITIVE) ===
// Inside the ReadableStream pull() callback (response.ts:53-65), AFTER draining pendingPulls:
pull: () => {
  while (this.pendingPulls.length > 0) { const next = this.pendingPulls.shift(); next?.(); }
  // NEW: Node Writable parity — signal room available so consumers parked on
  // 'drain' (Effect's streaming write loop, generic Node http) resume.
  // TODO(ADR): Q-2026-05-30-102
  this.emit('drain');
},
// NOTE: only emit when a prior write() actually returned the backpressure Promise,
// to avoid spurious 'drain' before any backpressure (track a `_needDrain` flag set in write()).

// === packages/net/src/http/response.ts — Q-103 pipe-sink duck shape (ADDITIVE, BOUNDED) ===
// ServerResponse already has write(), end(), emit/on/off/once (EventEmitter).
// pipe(dest) in @rifty/io readable.ts:488 wires dest.on('drain') + dest.write + dest.end + dest.on('error'/'close').
// Add a defensive 'error' path so a piped source error doesn't go unhandled:
// ServerResponse: on first 'error' listener-less emit, destroy the stream controller.
// (No new public method strictly required — the duck shape is satisfied. Verify in test.)

// === packages/io/src/streams/readable.ts — Q-103 typing widen (ADDITIVE, in lower layer) ===
// PipeableWritable.write currently typed `(chunk) => boolean`. ServerResponse.write returns
// `boolean | Promise<boolean>` which is NOT assignable. Widen the duck-type return:
interface PipeableWritable extends EventEmitter {
  write(chunk: unknown): boolean | Promise<boolean>; // widened; pipe treats Promise as truthy (no pause), 'drain' resumes
  end(): unknown;
  emit: EventEmitter['emit'];
}

// === tests/integration/fixtures/opencode-effect-http-smoke.ts (NEW, forked from real-vite-smoke.ts) ===
// memory VFS -> install @effect/platform + @effect/platform-node@<pinned> from live npm
// -> import register-builtins (node:http) -> build ONLY NodeHttpServer.layer over a 1-route
// HttpRouter ('/version' -> 200 JSON) -> server.listen({ port: 4096 }) registers in port registry
// -> dispatchToPort(4096, new Request('http://preview.local/version')) -> assert 200 + JSON body.
// Prints RIFTY_OPENCODE_HTTP_SMOKE_OK. Runs under tsx, sandbox-disabled (live npm).
```

### Risks

- **Parity runner CANNOT host this feature:** `tools/node-parity-runner` only loads `@rifty/runtime-js/loader` and does NOT register `node:http` (the `node:http` builtin lives in `@rifty/net`, which the runner never imports — see `parse-url.case.ts:9-13` stating exactly this). So the CLAUDE.md 'parity is the gold standard' default is architecturally unavailable here; the primary tests are `packages/net` UNIT tests asserting Node-faithful behavior, cross-checked against a one-shot manual Node reference where cheap. This is a justified deviation, not a shortcut.
- **Q-102 spurious `'drain'`:** emitting `'drain'` on every `pull()` (even when no write was backpressured) can fire `'drain'` before any backpressure, which diverges from Node (Node only emits `'drain'` after `write()` returned `false`). Mitigation in scaffolding: gate emission behind a `_needDrain` flag set only when `write()` actually returned the backpressure Promise. A naive unconditional emit risks confusing other future Node consumers.
- **Q-103 typing:** `ServerResponse.write` returns `boolean|Promise<boolean>`, which is NOT structurally assignable to `readable.ts` `PipeableWritable.write(): boolean`. The fix lives in `@rifty/io` (lower layer) by widening `PipeableWritable`'s return type — correct direction (net depends on io), but it touches a SECOND package/file. Two files total (`response.ts` + `readable.ts`) still satisfies REVERSIBLE rule 4 (<=2 files), but it nudges the boundary; keep `readable.ts` change to the one-line return-type widen only.
- **Buffered-reassembly ceiling:** End-to-end streaming through the SW/cross-realm bridge is bounded by ADR-0048 (page side reassembles buffered, no true cross-realm backpressure until M12/ADR-0017). Even with `'drain'` correct server-side, P4 LLM streaming over the bridge is limited by that existing ceiling — NOT solved by this feature. Tests T3/T4 prove server-side semantics only; do not over-claim e2e streaming.
- **Upgrade silent-swallow:** WebSocket/SSE upgrade (Effect's `assignSocket` + `server.on('upgrade')`) is a HARD-BLOCKER-adjacent path owned by feature 07. T5 (negative test) must lock that this feature does NOT silently swallow an upgrade attempt into the buffered path — if it does, an SSE LLM round-trip (feature 08) would corrupt silently.
- **Effect version pinning:** `@effect/platform-node` version pinning: the de-risk finding referenced `4.0.0-beta.66`. The exact `internal/httpServer.ts` behavior (parks on `'drain'`, ignores `write()` return, uses `Readable.fromWeb(...).pipe`) is beta-version-sensitive; pin the version in the integration harness fixture and record it, or the harness breaks on beta drift.
- **T6 transitive deps:** Integration harness (T6) transitively needs features 02 (TS-on-import) and 04 (`#db`/`#pty` shims) to even import `@effect/platform-node`'s module graph without tripping `bun:sqlite`. The `dependsOn` is real: T6 cannot run green until 02+04 land. T1-T5 (unit) do NOT need them and validate the bridge in isolation — this is the intended decoupling so feature 05 is independently verifiable.

### Estimate

3-4 evening-units for the REVERSIBLE parts (Q-101 ~0.5, Q-102 ~1, Q-103 ~1 incl. `readable.ts` typing widen, integration harness ~1.5). The integration harness (T6) is BLOCKED until the ratification gate clears AND depends on features 02 + 04 landing; the three unit-level tasks (T1-T5) are unblocked once ratified and can proceed independently of 02/04.

### Ratification gate

**BLOCKED** until the IRREVERSIBLE strategy decision is ratified: ADR draft *"Effect @effect/platform-node consumes rifty node:http AS-IS via additive shape-widening (no dedicated cross-package Effect HTTP adapter)"* (the 4th design decision, `needsHumanRatification=true`). The fork is: option (a) widen the existing `node:http` surface (recommended, keeps everything REVERSIBLE) vs option (b)/(c) ship a new cross-package Effect adapter export in `packages/net` (IRREVERSIBLE per checklist rule 1 — new public API between packages). All tasks below assume option (a). If a human ratifies (b)/(c) instead, T1-T6 must be re-scoped around a new exported adapter symbol. Per CLAUDE.md the IRREVERSIBLE choice must NOT be invented — do not start implementation until this ADR is ratified.

**SECONDARY note (not a gate, but a documented gap):** Effect's `Readable.fromWeb(body).pipe(res)` path needs Node's static `Readable.fromWeb`, which `@rifty/io.Readable` does NOT implement; Q-103 only makes `ServerResponse` a valid `.pipe` TARGET — providing `Readable.fromWeb` is out of scope for feature 05 and must be tracked separately or deferred to P5.
