# Changelog

## [Unreleased]

### Added

- Port registry that maps `port → handler(Request) → Response`. The Service Worker uses this to dispatch `/preview/<port>/...` requests to listening user code.
- `node:net`: `Server`, `Socket`, `createServer`. `Server.listen(port)` registers a handler; closing unregisters.
- `node:http`: `Server` (built on `net`), `IncomingMessage`, `ServerResponse`, `request`. The Express + body-parser + cors flow is testable via the registry directly.
- `dispatchToPort(port, Request)` helper used by tests and the SW.
- **M10:** `WebSocket`, `WebSocketServer`, `WebSocketConnection` — in-process URL-routed duplex matching the browser/Node `ws` surface (`'open'`/`'message'`/`'close'`, `broadcast`, `readyState` constants). 5 conformance tests.
