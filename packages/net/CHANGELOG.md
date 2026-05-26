# Changelog

## [Unreleased]

### Changed

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
