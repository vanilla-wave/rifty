# ADR 0151: HTTP WebSocket upgrade over bridge

Status: Accepted
Date: 2026-06-17

> TL;DR: `http.Server` emits WebSocket `'upgrade'` over the same-origin bridge; no raw TCP claim.

> Correction 2026-06-18: control frames now relay where a real `ws` peer can
> consume them. Browser-like clients still do not surface ping/pong as
> `message`; local real `ws` clients can `ping()` and receive the server's actual
> `pong()` over the bridge, while server pings are still answered in the
> transport.

## Context

ADR-0147 made browser `new WebSocket()` reach `@riftydev/net.WebSocketServer`
across same-origin realms, enough for custom dev servers and the current Vite
HMR channel adapter. Real Node starters also use the ecosystem path:
`http.createServer()` plus `server.on('upgrade')`, commonly through npm `ws` via
`new WebSocketServer({ server })`.

The old `http-upgrade-websocket` backlog item intentionally locked this path
out because the port registry only carried `Request → Response`. That is now
too narrow: a WebSocket open is not HTTP fetch, but the bridge open frame can
carry the missing upgrade attempt and then exchange RFC 6455 frames with the
server-side socket.

## Decision

Implement WebSocket upgrade as a bridge-backed socket path in `@riftydev/net`:

- normal HTTP dispatch remains `Request → Response`;
- upgrade-shaped HTTP `Request`s are rejected, never routed as `'request'`;
- bridge `open` frames for a listening `HttpServer` emit
  `server.on('upgrade', (req, socket, head) => ...)`;
- `socket` validates the server's 101 handshake, verifies
  `Sec-WebSocket-Accept`, propagates the selected subprotocol, and translates
  RFC 6455 frames between server code and the browser bridge;
- the real npm `ws` package in server and client modes is a compatibility test
  target for registered local ports.

This supersedes the `http-upgrade-websocket` negative boundary and ADR-0145's
Vite-only `server.hmr.channels` transport path. It does not change ADR-0017's
raw TCP boundary: `net.Socket.connect` remains a loud `NotImplementedError`.

## Consequences

- Real `ws` servers and local-port `ws` clients can run through `http.Server`;
  Real-Vite HMR is now one consumer of the same upgrade path, not a special Vite
  channel.
- Fetch/preview HTTP semantics stay intact; there is still no fake HTTP 101
  `Response`.
- Browser-like clients do not expose ping/pong to app code, matching browser
  `WebSocket`. Local real `ws` peers can exchange control frames through the
  bridge; server pings are still answered in the transport.
- Raw TCP and arbitrary host egress remain outside `node:http` WebSocket upgrade
  support; preview-local `wss://` maps to the same bridge with
  `socket.encrypted`.
