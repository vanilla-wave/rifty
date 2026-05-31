# Changelog

## [Unreleased]

### Documented

- **WS/SSE upgrade is the feature-07 boundary (F05-T5, negative lock).** Added a
  net-only conformance test pinning that feature 05's buffered HTTP surface does
  NOT silently consume a WebSocket/SSE upgrade: `ServerResponse` exposes no
  `assignSocket` sink, and the server emits no `'upgrade'` (nor mis-routes an
  upgrade through the buffered `'request'` dispatch). No new code path — the
  test documents the intentional gap and goes red if a fake upgrade entry point
  is wired (protecting feature 08's SSE round-trip from silent corruption).
  Registered the `http.Server` WS/SSE upgrade path as not-supported (❌) in
  `docs/compat/m10-tooling.md` (ADR-0055 — PTY/WS-shaped routes stay stubbed).
  Test: `packages/net/src/http/server.test.ts`.

### Added

- **`node:sqlite` `DatabaseSync` facade — constructor + `exec()` + `close()`
  over sql.js (ADR-0065, `databasesync-construct-exec-close`).** New
  `packages/net/src/sqlite/database-sync.ts` adds a synchronous
  `DatabaseSync`-shaped class on top of the engine bridge: `new
  DatabaseSync(filename, { open, enableForeignKeyConstraints, … })` (in-memory
  for the first cut regardless of `filename`; `:memory:` is opencode's boot
  path), `exec(sql)` (multi-statement `;`-separated, returns `undefined`,
  tolerant `PRAGMA journal_mode = WAL`), `open()`, and `close()` (double-close
  throws Node-shaped `ERR_INVALID_STATE`). New
  `packages/net/src/sqlite/register-builtins.ts` is an opt-in side-effect module
  that registers the `node:sqlite` builtin via `@rifty/io`'s `registerBuiltin`
  (harness-local, mirroring `net/register-builtins.ts`; Q-2026-05-31-302
  Option A) — the heavy WASM engine stays out of default loads. `prepare()` and
  the rest of Node's `DatabaseSync` prototype (`location`/`function`/`aggregate`/
  session/extension) throw `NotImplementedError` with a `docs/compat/sqlite.md`
  entry (no silent stubs, ADR-0065 D4); they land in follow-up tasks. New net
  subpath exports: `./sqlite/engine`, `./sqlite/database-sync`,
  `./sqlite/register-builtins`. Head-to-head parity vs real Node `node:sqlite`:
  `tools/node-parity-runner/cases/sqlite/construct-exec.case.ts` (new opt-in
  parity `kind: 'sqlite'` mode that registers `node:sqlite` + awaits
  `initSqliteEngine()`). Known first-cut gaps in `docs/compat/sqlite.md`
  (in-memory only; DQS stays ON — use single-quoted SQL literals for Node
  parity).

- **sql.js WASM engine bring-up for the `node:sqlite` shim (ADR-0065,
  `sqlite-wasm-init`).** New `packages/net/src/sqlite/engine.ts` adds
  `initSqliteEngine()` (async, memoised, one WASM bring-up per process,
  resolving the synchronous `SqlJsStatic` handle), `getSqliteEngine()`
  (synchronous accessor that throws a clear "engine not initialized" error
  before init — never a silent `null`), and `isSqliteEngineReady()`. This is
  the sync-surface-over-async-WASM bridge the synchronous `DatabaseSync`
  constructor (opencode's eager Effect layer-build boot path, Spike C) depends
  on. In-memory only; OPFS persistence deferred (ADR-0065 §D2). New dep:
  `sql.js` (+ `@types/sql.js` dev). The `DatabaseSync`-shaped facade and
  `node:sqlite` builtin registration land in a follow-up task on top of this
  bridge. Test: `packages/net/src/sqlite/engine.test.ts`.

- **`ServerResponse` emits Node-style `'drain'` after a backpressured write
  (Q-2026-05-30-102).** When a `write()` returned the backpressure Promise
  (queue full at `desiredSize <= 0`), the next `ReadableStream` `pull()` now
  emits a Node `Writable`-parity `'drain'` event, gated by an internal
  `_needDrain` flag so no spurious `'drain'` fires before any backpressure
  occurred. Required by `@effect/platform-node`'s streaming write loop, which
  parks on `res.on('drain')` and ignores `write()`'s return value. Additive —
  `write()`'s `boolean | Promise<boolean>` return is unchanged; existing
  rifty/express callers that ignore the event are unaffected. No `'drain'` is
  emitted after `end()` (Node parity). Tests:
  `packages/net/src/http/response.test.ts`.

- **`HttpServer.listen` options-object overload (Q-2026-05-30-101).** `listen`
  now accepts Node's `listen({ port, host }, cb)` form in addition to the
  bare-number `listen(port, hostnameOrCb?, cb?)` form, extracting the numeric
  port from either. Previously the options object was assigned verbatim as the
  registry key, so the port was unroutable (502) while `'listening'` still
  fired (the silent-bind trap). Required by `@effect/platform-node`'s
  `NodeHttpServer.layer`, which always drives `listen` via the options form;
  also a genuine Node-parity gap. Additive — the bare-number path is unchanged.
  Tests: `packages/net/src/http/server.test.ts`.

- **Streaming cross-realm preview wire-frame (ADR-0048).** `serveCrossRealmPreview`
  now drains `response.body` and posts ordered `reply-stream-{start,chunk,end,error}`
  frames (≤64 KiB/chunk); `bridgeCrossRealmPreview` reassembles them. New net-local
  `PREVIEW_PORT_FRAME_VERSION` ('1'→'2') pins the page↔worker frame — deliberately
  NOT `SW_FRAME_VERSION` (a different hop, owned by `@rifty/service-worker`; importing
  it would be a sibling/reverse import). Reply mode is chosen **per request** from the
  request's `v` (the worker outlives page reloads, so a per-channel pin would deliver
  stream frames to a freshly-connected old page — a silent wrong answer). The buffered
  `reply` frame is retained as the negotiated fallback + null-body fast path. Idle
  (no-progress) timeout re-arms per chunk; the stream accumulator lives on the single
  `pending` entry so every terminal path frees it. Page-side memory unchanged
  (accumulate-then-concat); true end-to-end `ReadableStream` is M12 (ADR-0017).
  Conformance: `packages/net/src/cross-realm/preview-port.test.ts` (large-body, error
  mid-stream, version mismatch, idle re-arm, seq-gap, dispose).

- **ADR-0043 (M11 Vite-in-Worker) — cross-realm preview-port bridge.** New
  module `src/cross-realm/preview-port.ts` exports
  `previewPortChannelUrl(port)`, `serveCrossRealmPreview(port, dispatch)`,
  and `bridgeCrossRealmPreview(port, opts?)`. Bridges the page-realm
  `dispatchToPort()` to a Worker-realm HTTP-shape listener over
  `BroadcastChannel` — same primitive as the HMR bridge
  (`BridgedWebSocketServer`) so the M12 ADR-0017 rewrite can swap both to
  dedicated `MessagePort`s in one pass. 6 unit tests cover GET round-trip,
  4 KiB POST body preservation, worker-side throw → 502, and
  configurable timeout → 502.

### Added

- **M7 acceptance coverage:** `tests/e2e/m7-preview-sw.spec.ts` proves an
  HTTP request rounds through the Service Worker preview path end-to-end —
  the playground's main-thread `http.createServer().listen(3000)` (via
  `@rifty/net`) is reached by a `fetch('/preview/3000/')` that crosses the
  SW interceptor + cross-realm `MessageChannel` + `packSerializedResponse`
  carrier and returns the registered handler's bytes. Closes the gap
  flagged by the 2026-05-26 architecture audit: `tests/integration/express-style.test.ts`
  calls `dispatchToPort(port, request)` directly and bypasses the SW path,
  so before this spec the PROJECT_PLAN.md M7 acceptance line
  ("Express 'hello world' → see page in browser") was not test-covered.

### Changed

- `src/register-builtins.ts` drops the `as unknown as Record<string, unknown>`
  cast from each `registerBuiltin('net' | 'http' | 'https', () => ...)` call
  (3 sites) now that `BuiltinFactory` in `@rifty/io` is generic. No behaviour
  change.

- **ADR-0036:** the `/preview/<port>/...` URL scheme and `preview.local`
  synthetic host are now documented in `@rifty/io/preview-protocol`
  rather than as a hand-written prose comment in `src/registry.ts`. The
  doc comment cross-references the shared module so adapters that need
  to parse a preview URL or synthesise the upstream form know where the
  canonical primitives live. No `net` runtime behaviour changes — `net`
  did not parse preview URLs itself; the addressing was duplicated
  implicitly between SW's regex and `net`'s prose. ADR-0036 closes the
  silent-drift hazard.

### Fixed

- **ADR-0035: reverse import on `@rifty/runtime-js` removed.**
  `src/register-builtins.ts` now imports `registerBuiltin` from
  `@rifty/io` instead of `@rifty/runtime-js`; `package.json` drops the
  `@rifty/runtime-js` dependency. The `register-builtins.ts`
  side-effect pattern is unchanged — `net` still owns the
  `node:net`/`node:http`/`node:https` registrations — only the source
  of the registry function has moved. Closes the residual reverse-import
  edge noted in ADR-0012's implementation note and `TASKS.md`.

### Changed

- **ADR-0034 (D-B):** `IncomingMessage` and `IncomingMessageFromFetch` now sit
  on top of an `@rifty/io` `Readable` whose contract has been restored to
  Node-shape (`_readableState`, `read(n)`, proper destroy + EOF transitions).
  No source change in this package — the consumption pattern via
  `target.push(chunk)` and `target.push(null)` works the same — but
  destroy-on-abort and frame-aligned reads (e.g. by `body-parser` style
  consumers) now behave per Node. See `packages/io/CHANGELOG.md` and ADR-0034.

### Added

- `channelNameFor(url)` — previously-internal helper that derives the
  `BroadcastChannel` name from a WS url is now part of the public WS
  surface (re-exported from `index.ts` / `ws.ts`). The playground HMR
  bridge injects a vanilla-JS client into the preview iframe that has to
  reach the same channel without importing `@rifty/net`; this is the
  seam that lets the inlined client agree with `BridgedWebSocketServer`
  on the channel without duplicating the prefix convention. Closes
  ADR-0017 phase 1 acceptance for the iframe HMR client.
- Port registry that maps `port → handler(Request) → Response`. The Service Worker uses this to dispatch `/preview/<port>/...` requests to listening user code.
- `node:net`: `Server`, `Socket`, `createServer`. `Server.listen(port)` registers a handler; closing unregisters.
- `node:http`: `Server` (built on `net`), `IncomingMessage`, `ServerResponse`, `request`. The Express + body-parser + cors flow is testable via the registry directly.
- `dispatchToPort(port, Request)` helper used by tests and the SW.
- **M10:** `WebSocket`, `WebSocketServer`, `WebSocketConnection` — in-process URL-routed duplex matching the browser/Node `ws` surface (`'open'`/`'message'`/`'close'`, `broadcast`, `readyState` constants). 5 conformance tests.
- `HttpFramedSocket` — explicit name for the HTTP-framed pseudo-socket previously exported as `Socket`. The class carries HTTP/1.1 wire bytes, not raw TCP. `Socket` remains as a deprecated alias that emits a one-shot `console.warn` on instantiation; `connect()` throws `NotImplementedError`. (Fixes 2026-05-25 silent-stub review item 1.3 #2.)
- `IncomingMessage.socket` now exposes a minimal Node-compatible shape (`remoteAddress`, `localAddress`, `remotePort`, `localPort`, `destroy()`) instead of an empty object. (Fixes 2026-05-25 silent-stub review item 1.3 #1.)
- `registry.dispatchToPort` returns the no-listener 502 with a JSON body (`{"error":"no_listener","port":<n>}`) and an explicit `Content-Type: application/json` header. (Fixes 2026-05-25 silent-stub review item 1.3 #3.)

### Changed

- **ADR-0017 phase 1 finish (reader-side):** `IncomingMessage` and `IncomingMessageFromFetch` now consume `request.body` / `response.body` as a `ReadableStream<Uint8Array>` and push each chunk to `'data'` listeners as it arrives, instead of buffering through `arrayBuffer()` and pushing the whole body in one go. Chunked uploads / streaming responses now propagate chunk boundaries end-to-end.
- `ServerResponse.write()` honors backpressure: when the underlying `ReadableStream` controller reports `desiredSize <= 0`, the method returns `Promise<true>` that resolves only after the consumer pulls. Synchronous `true` is returned when the queue has room or `desiredSize` is `null`. Existing callers that ignore the return value continue to work. (Fixes 2026-05-25 silent-stub review item 2.5 / Phase 1 backpressure gap.)
