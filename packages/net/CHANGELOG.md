# Changelog

## [Unreleased]

### Added

- **Default WebSocket surface crosses same-origin realms (ADR-0147).**
  `WebSocket` / `WebSocketServer` keep the same-realm fast path and fall back to
  the bridge protocol when client and server live in different realms. Servers
  listen on URL + port-discovery channels and validate the requested URL, so
  wildcard hosts work for preview domains. New `webSocketBridgeClientScript()`
  lets hosts inject a generic browser `window.WebSocket` bridge before framework
  dev clients run.
- **`http.Server` WebSocket upgrade over the bridge (ADR-0151).**
  Bridge `open` frames now emit `server.on('upgrade')` with a Node-shaped socket
  that validates the 101 handshake and translates RFC 6455 frames. The real npm
  `ws` package in `new WebSocketServer({ server })` mode and client mode is
  pinned by CI.
- **External `ws` clients use native WebSocket egress.** Non-local WebSocket
  client upgrades no longer fail with the local-port bridge error; the worker
  opens a real browser `WebSocket` and adapts it to the RFC6455 client socket
  used by npm `ws`. Local registered ports stay on the in-process bridge.
- **Raw TCP connect APIs are explicit loud ceilings.** `net.connect`,
  `net.createConnection`, and `Socket.connect` throw directed
  `NotImplementedError`s instead of leaving missing/ambiguous raw TCP surface.

### Fixed

- **WebSocket `close()` never hangs when the peer realm disappears.** After
  `OPEN`, all three clients (browser shim, default `WebSocket`, `BridgedWebSocket`)
  waited for the server close echo with no fallback — a terminated peer realm
  (navigated iframe, killed worker) stranded them in `CLOSING` forever, never
  firing `'close'` and leaking their `BroadcastChannel`s. They now mirror the
  connect timeout and end the handshake locally with 1006. Regression: dead-peer
  `close()` still fires `'close'` across all three clients.
- **`CloseEvent.wasClean` is honest on every client.** The in-process `WebSocket`
  and `BridgedWebSocket` built close events without `wasClean` (defaulting
  `false`), so even a clean 1000/1001 read as unclean; all three clients now
  compute `wasClean = code !== 1006 && state !== CONNECTING` (incl. a
  client-initiated close completed by the server echo).
- **In-process bridge connect timeout unified to 1000 ms.** The default
  `WebSocket`'s 100 ms open-ack window raced a slow page↔worker open into a false
  1006; now matches the shim and `BridgedWebSocket`.
- **Browser shim sends frames FIFO across async Blob reads.** `send(blob)`
  deferred its `postMessage` to a microtask while string/ArrayBuffer frames went
  synchronously, silently reordering `send(blob); send(text)`. A per-socket send
  queue preserves call order and `bufferedAmount` now tracks queued-but-unsent
  bytes instead of a static 0.
- **In-process `WebSocket` honors `binaryType` and exposes the full surface.**
  Binary frames are delivered as `Blob`/`ArrayBuffer` per `binaryType` (was raw
  bytes), and the client gains instance readyState constants +
  `onopen`/`onmessage`/`onclose`/`onerror` handler properties.
- **WebSocket egress collapses reserved close codes to a bodyless frame.** A
  browser `CloseEvent` on the native external-host path could surface 1015 (TLS)
  or 1004, which were re-encoded as a 2-byte body and rejected by real `ws` as
  `WS_ERR_INVALID_CLOSE_CODE`; any non-sendable reserved code now sends a bodyless
  close. The upgrade socket also echoes a Close back to the `ws` server on a
  server-initiated close so its `'close'` reports the negotiated code, not 1006.
- **Graceful WebSocket close no longer puts a reserved code on the wire.** A
  bodyless `ws.close()` (no status) parses to 1005 and was re-encoded as a
  2-byte 1005 body, which the real `ws` receiver rejects with
  `WS_ERR_INVALID_CLOSE_CODE` (aborting 1002). The upgrade socket now emits a
  bodyless close frame for 1005 and tears the socket without a frame for 1006,
  so a real `ws` peer concludes 1005/1006 cleanly. Regression: real-ws-client
  sees a graceful server close as a clean 1005.
- **Real `ws` `bufferedAmount` reads an honest 0 on server-side upgrade
  sockets.** The server socket lacked `_writableState.length`, so `ws`'s
  `bufferedAmount` getter (`_writableState.length + _sender._bufferedBytes`)
  returned `NaN`; the bridge keeps no send queue, so it now reports 0 (mirroring
  the client socket).
- **WebSocket bridge host matching now honors only configured hosts.**
  `webSocketBridgeClientScript()` no longer intercepts arbitrary `ws://` URLs
  on the page's own hostname; same-host application sockets fall through to the
  native browser `WebSocket` unless the host is explicitly listed.
- **Cross-realm WebSocket port discovery rejects URL-less opens.** Servers now
  require the client `url` on port-channel open frames before wildcard
  host/path matching, so a discovery frame cannot bypass route validation.
- **WebSocket clients match native CONNECTING `send()` behavior.** Calling
  `send()` before the browser shim, default `WebSocket`, or `BridgedWebSocket`
  reaches `OPEN` throws `InvalidStateError` instead of silently dropping data.
- **WebSocket bridge close/binary/subprotocol parity tightened.** Client
  `close()` now waits for the server close frame after `OPEN`, `destroy()` /
  `terminate()` propagates abnormal close to clients, browser bridge binary
  messages honor `binaryType`, invalid close codes/reasons and duplicated
  subprotocols throw, masked server frames are rejected, and `wss://` preview
  opens reach `server.on('upgrade')` with `socket.encrypted === true`.
- **Unbounded preview bodies fail loud over the cross-realm preview bridge.**
  `serveCrossRealmPreview` still refuses `text/event-stream` immediately, and
  now also bounds every other body drain with `streamDrainTimeoutMs`; an active
  but never-ending NDJSON/log-tail stream returns a 502 naming
  `net.preview.cross-realm-unbounded-body` instead of keeping the page
  accumulator alive forever.
- **`http.request` bodies stream through local loopback.** `req.write()` chunks
  feed a live `ReadableStream` instead of a final `Blob`, so server-side
  `IncomingMessage` sees chunk boundaries before `end()`. `write()` returns
  `false` when the stream queue is full and emits `drain` after the consumer
  pulls.
- **`register-builtins` modules now expose idempotent callable registrars.**
  `registerNetBuiltins()` and `registerSqliteBuiltin()` preserve the old
  side-effect import behavior while letting production workers call the
  registration explicitly, so bundlers cannot drop `node:http` / `node:sqlite`
  registration as unused side effects.
- **Null-body statuses (204/205/304/1xx) no longer throw on dispatch.** The
  fetch `Response` constructor rejects ANY body for them; `res.status(204).end()`
  (express DELETE handlers) blew up. Body is now `null`, chunked framing omitted.
- **Bodied requests without `content-length`/`transfer-encoding` now present
  `transfer-encoding: chunked`** on `IncomingMessage` — browsers strip
  `content-length` when a Request is rebuilt across the preview bridge
  (forbidden request header), so typeis-style `hasBody()` (express.json)
  silently skipped bodies.
- **sqlite engine survives a process-shim swap.** `defaultLocateFile` ran
  inside the async WASM bring-up; after `installProcessGlobals()` the rifty
  shim (has `versions.node`, lacks `getBuiltinModule`) made init throw deep in
  sql.js and the memoised promise never settled. The Node binding is captured
  at module-eval time.

### Performance

- **Lazy + single-`URL` net micro-fixes (#9, gate G2).** Two byte-identical wins on the request hot path: (a) `net.ts`'s `Server.listen` handler built `new URL(request.url)` TWICE in one template literal (`.pathname` + `.search`) — hoisted to a single `const u = new URL(...)`, reused for both (pure CSE). (b) `http/request.ts` computed `Object.fromEntries(headers)` eagerly in BOTH `IncomingMessage` and `IncomingMessageFromFetch` constructors; now deferred to first read of `req.headers` via a self-replacing accessor (`defineLazyHeaders`) — a configurable getter that, on first read, materialises the record and `Object.defineProperty`'s itself into a **writable**+enumerable+configurable data property, with a setter for the write-before-read path. Writability is load-bearing (gate G2): Express reassigns `req.headers = {...}` (trust-proxy / body-parser), which a getter-only accessor would break — so this stays behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only, no ADR). The plan's third sub-action (pre-sized http body) was a no-op: `net.ts`'s `new Uint8Array(await request.arrayBuffer())` is already an exact-length zero-copy view. Guard: `http/request.test.ts` (lazy compute, identity-stable, reassign before+after read, writable+enumerable+configurable descriptor, both classes) + new parity `http/server-headers-reassign.case.ts` (header read → Express reassign + path/query echo after the single-URL change). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#9).
- **Preview-port stream reassembly pushes the cloned chunk directly (#22a).** `bridgeCrossRealmPreview`'s `reply-stream-chunk` handler copied `frame.data` into a fresh `Uint8Array` before pushing it onto the accumulator. But `frame.data` already arrives via `BroadcastChannel.postMessage`'s structured clone — a fresh, page-realm-owned, exclusively-aliased buffer that is read exactly once and never mutated. The re-copy duplicated a buffer nobody else aliases (one O(M) copy per chunk). Now `accum.chunks.push(frame.data)` directly; the terminal `reply-stream-end` concat honours `byteLength` either way. No wire-frame / observable-behavior change — preview e2e (m7-preview-sw, m10-hmr) and the streaming unit tests assert identical reassembled bytes. Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#22).
- **Hoisted module-level UTF8 codec singletons** in `net.ts` (`UTF8_ENCODER`/`UTF8_DECODER`) and `http/server.ts` (`UTF8_ENCODER`) — `HttpFramedSocket.write`, the server head encode, the response decode, and the `http.request` body-chunk encode no longer construct a `TextEncoder`/`TextDecoder` per call. One-shot utf8 codec is stateless (default non-fatal config), so a shared instance is byte-identical. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (+ `js-runtime-perf-adr-plan-2026-06-06.md`); behavior-preserving, http/net parity + conformance green.

### Added

- **`node:http.STATUS_CODES`** — the standard status-code → reason-phrase map
  (faithful copy of Node v24). Real packages read `STATUS_CODES[code]` to format
  messages; opencode's provider error path (`provider/error.ts`) does
  `STATUS_CODES[e.statusCode]` and would `TypeError` on the missing export. Parity:
  `http/status-codes.case.ts`.

### Fixed

- **`node:http` loopback self-calls now stay in-process.** `http.request()` and
  `http.get()` route `http:` requests for registered local ports (`localhost`,
  whole `127.0.0.0/8`, `0.0.0.0`, IPv6 loopback) through the existing port
  registry instead of falling out to real `fetch()`. External hosts and
  non-HTTP URLs still use `fetch()`. Guards:
  `packages/net/src/http/client.test.ts` and
  `tests/conformance/builtins/http.test.ts`.
- **Unregistered loopback ports fail with Node-shaped `ECONNREFUSED`** (`code`,
  `errno -111`, `syscall 'connect'`, `address`, `port`) instead of leaking the
  request to the HOST machine's real loopback via `fetch()` — a sandboxed probe
  of `localhost:5173` could silently get the playground's own dev server. The
  registry is the realm's whole network namespace; servers in other Workers are
  not reachable either way (`docs/backlog/net/cross-realm-http-loopback`).
- **`http.request` client matches more Node `ClientRequest` shapes.** 3-arg
  `request(url, options, cb)` (options override URL parts), `end(callback)` as
  finish callback (was: callback sent as body), `'finish'` event, repeated bare
  `end()` no longer double-dispatches, and `write()`/`end(chunk)` after end emit
  `ERR_STREAM_WRITE_AFTER_END`. Request body streaming/backpressure is covered
  by the newer Unreleased entry above. Guards: `http/client.test.ts`.
- **WebSocket `'close'` no longer depends on a global `CloseEvent`.** `ws/bridge.ts`
  and `ws/in-process.ts` constructed `new CloseEvent(...)`, a global only present in
  browsers and Node ≥23 — under a `node` test env on Node 22 (our `engines` floor)
  it threw `ReferenceError: CloseEvent is not defined`, failing the `ws` conformance
  suite on CI. A new `ws/close-event.ts` resolves the native constructor when present
  and otherwise a faithful `Event` subclass carrying `code`/`reason`/`wasClean`.
- **`node:sqlite` `StatementSync` default-read integer overflow now throws
  instead of truncating (ADR-0065 finding #2, parity-verified vs Node v24).**
  Under the default `setReadBigInts(false)` (effect's `Client.SafeIntegers`
  Context.Reference default, invoked per-query by the real
  `@effect/sql-sqlite-node` driver), reading an INTEGER value past
  `Number.MAX_SAFE_INTEGER` previously returned a silently-truncated float
  (`9223372036854775807` came back as `9223372036854776000`). It now throws
  Node's `RangeError` with code `ERR_OUT_OF_RANGE`, matching real `node:sqlite`
  exactly — the first refused value is `2^53` (= `MAX_SAFE + 1`), and the safe
  ceiling `Number.MAX_SAFE_INTEGER` still reads fine. The guard
  (`Number.isInteger(v) && !Number.isSafeInteger(v)`) lives in `#readRow` and
  applies to both object-keyed and array-shaped rows. Known limitation
  (documented in `docs/compat/sqlite.md`): a whole-valued REAL above `2^53` is
  guarded too, since the prebuilt sql.js WASM exposes no per-column
  `sqlite3_column_type`. Head-to-head parity:
  `tools/node-parity-runner/cases/sqlite/read-bigint-overflow.case.ts`;
  unit-pinned in `packages/net/src/sqlite/database-sync.test.ts`.

### Added

- **`node:sqlite` opencode-boot conformance gate + head-to-head parity
  (ADR-0065, P2 boot prerequisite).** Added the conformance test
  `tests/conformance/builtins/sqlite-opencode-boot.test.ts`, which runs
  opencode's EXACT database-boot sequence through `require('node:sqlite')` inside
  the real rifty module loader (resolving the builtin via the `@riftydev/io`
  registry that `@riftydev/net/sqlite/register-builtins` populates): open `:memory:`
  with FK constraints, the post-open `PRAGMA journal_mode = WAL`,
  `Database.layer`'s six PRAGMAs via `prepare(pragma).all()`, then
  `DatabaseMigration.apply` — the `migration` journal `CREATE TABLE IF NOT
  EXISTS`, the fresh-boot seed-detection `SELECT`s (empty journal, no
  `__drizzle_migrations`), and the first real migration
  `20260127222353_familiar_lady_ursula` (eight `CREATE TABLE`s with forward FKs +
  six `CREATE INDEX`es) inside a `begin deferred` … `commit` transaction,
  asserting the committed `migration` row reads back. This is the gate that says
  "rifty can boot opencode's database layer without throwing". Its head-to-head
  twin against real Node `node:sqlite` is
  `tools/node-parity-runner/cases/sqlite/opencode-boot-sequence.case.ts` (the
  whole sequence; both stdouts agree byte-for-byte). No new shim code — both
  exercise the existing sql.js-backed `DatabaseSync`/`StatementSync` surface; the
  gate goes red if any statement on opencode's boot path regresses.
- **`node:sqlite` `StatementSync` — complete the per-query contract:
  `iterate()`, named parameters, `setAllowBareNamedParameters` (ADR-0065,
  `statement-run-get-iterate-columns`).** `StatementSync.iterate(...params)` is
  now a real lazy generator that yields rows in cursor order (the configured
  object/tuple shape) and resets the statement on exhaustion or early `break`,
  replacing the prior `NotImplementedError`. `all`/`get`/`run`/`iterate` now also
  accept a single named-parameter object: sigil-prefixed keys (`{ ':id' }`) bind
  by name directly, and bare keys (`{ id }`) are prefixed with `:` when bare keys
  are allowed. New `setAllowBareNamedParameters(bool)` (default `true`, as Node)
  gates bare keys — `false` makes them throw the Node-shaped `ERR_INVALID_STATE`.
  Head-to-head parity vs real Node `node:sqlite`:
  `tools/node-parity-runner/cases/sqlite/run-get-iterate.case.ts` (run-result
  shape, `get` row/`undefined`, `iterate` order, `:`-prefixed and bare named
  params).

### Changed

- **`node:sqlite` `StatementSync.setReadBigInts(true)` and `columns()` now throw
  `NotImplementedError` (ADR-0065 D4, no silent stubs).** The prebuilt sql.js
  WASM cannot back either faithfully, so faking a value is removed:
  `setReadBigInts(true)` previously coerced sql.js `number`s to `BigInt`, which
  silently loses precision above `Number.MAX_SAFE_INTEGER` (the number is already
  lossy before the cast) — it now throws
  `NotImplementedError('sqlite.Statement.setReadBigInts(true)')`; the `false`
  default plain-`number` path is unchanged. `columns()` requires SQLite's
  `SQLITE_ENABLE_COLUMN_METADATA` build (the engine exposes only
  `sqlite3_column_name`, not the table/database/decltype exports Node's
  `{ column, database, name, table, type }` needs), so it throws
  `NotImplementedError('sqlite.StatementSync.columns')` rather than return a
  partial shape. Both registered ❌ in `docs/compat/sqlite.md`. Unit-pinned in
  `packages/net/src/sqlite/database-sync.test.ts`.

- **`node:sqlite` `StatementSync` query surface — `prepare().all/get/run` +
  `setReturnArrays`/`setReadBigInts` over sql.js (ADR-0065,
  `statement-prepare-all-positional`).** New
  `packages/net/src/sqlite/statement-sync.ts` adds the synchronous
  `StatementSync`-shaped class returned by `DatabaseSync.prepare(sql)` — the
  exact query path the effect-drizzle session inside opencode runs on every
  query (`native.prepare(q).all(...params)` with positional `?` placeholders).
  `all(...params)` returns object-keyed rows by default and bare value-tuple
  rows after `setReturnArrays(true)`; `setReadBigInts(false)` (the default, and
  effect's SafeIntegers-default state) yields plain `number`s for INTEGER columns
  while `setReadBigInts(true)` coerces them to `BigInt` to match Node; an
  unmatched query returns `[]`. `run(...params)` returns Node's
  `{ lastInsertRowid, changes }`; `get(...params)` returns the first row or
  `undefined`. `DatabaseSync.prepare(sql)` now returns a `StatementSync` (throws
  Node-shaped `ERR_INVALID_STATE` if the database is not open) instead of the
  prior `NotImplementedError`. `StatementSync.iterate()` and the rest of Node's
  `StatementSync` prototype (`expandedSQL`/`sourceSQL`/`columns`/
  `setAllowBareNamedParameters`) throw `NotImplementedError` with a
  `docs/compat/sqlite.md` entry (no silent stubs, ADR-0065 D4). Head-to-head
  parity vs real Node `node:sqlite`:
  `tools/node-parity-runner/cases/sqlite/prepare-all.case.ts`. Known first-cut
  gap in `docs/compat/sqlite.md` (sql.js stores integers in a JS `number`, so
  values beyond `Number.MAX_SAFE_INTEGER` are lossy even before `setReadBigInts`).

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
  that registers the `node:sqlite` builtin via `@riftydev/io`'s `registerBuiltin`
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
  NOT `SW_FRAME_VERSION` (a different hop, owned by `@riftydev/service-worker`; importing
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
  `@riftydev/net`) is reached by a `fetch('/preview/3000/')` that crosses the
  SW interceptor + cross-realm `MessageChannel` + `packSerializedResponse`
  carrier and returns the registered handler's bytes. Closes the gap
  flagged by the 2026-05-26 architecture audit: `tests/integration/express-style.test.ts`
  calls `dispatchToPort(port, request)` directly and bypasses the SW path,
  so before this spec the PROJECT_PLAN.md M7 acceptance line
  ("Express 'hello world' → see page in browser") was not test-covered.

### Changed

- `src/register-builtins.ts` drops the `as unknown as Record<string, unknown>`
  cast from each `registerBuiltin('net' | 'http' | 'https', () => ...)` call
  (3 sites) now that `BuiltinFactory` in `@riftydev/io` is generic. No behaviour
  change.

- **ADR-0036:** the `/preview/<port>/...` URL scheme and `preview.local`
  synthetic host are now documented in `@riftydev/io/preview-protocol`
  rather than as a hand-written prose comment in `src/registry.ts`. The
  doc comment cross-references the shared module so adapters that need
  to parse a preview URL or synthesise the upstream form know where the
  canonical primitives live. No `net` runtime behaviour changes — `net`
  did not parse preview URLs itself; the addressing was duplicated
  implicitly between SW's regex and `net`'s prose. ADR-0036 closes the
  silent-drift hazard.

### Fixed

- **ADR-0035: reverse import on `@riftydev/runtime-js` removed.**
  `src/register-builtins.ts` now imports `registerBuiltin` from
  `@riftydev/io` instead of `@riftydev/runtime-js`; `package.json` drops the
  `@riftydev/runtime-js` dependency. The `register-builtins.ts`
  side-effect pattern is unchanged — `net` still owns the
  `node:net`/`node:http`/`node:https` registrations — only the source
  of the registry function has moved. Closes the residual reverse-import
  edge noted in ADR-0012's implementation note and `TASKS.md`.

### Changed

- **ADR-0034 (D-B):** `IncomingMessage` and `IncomingMessageFromFetch` now sit
  on top of an `@riftydev/io` `Readable` whose contract has been restored to
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
  reach the same channel without importing `@riftydev/net`; this is the
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
