# Changelog

## [Unreleased]

### Added

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
