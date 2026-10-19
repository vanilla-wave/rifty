# Map — node-fetch-classes-in-guest

## Items

1. `runtime-js/node-fetch-guest-carrier` — acceptance carrier — real Hono + Node/Chromium body, lifecycle and network differential cases.

## Open questions

- Source/build: Node 24.16.0 embeds undici 7.25.0; choose reproducible minimal class graph, prove Node-internal dependencies (Proxy detection, stream state) — owner: agent — isolated source spike + differential cases.
- Native consumers / response metadata / upload bridge — owner: agent — network carrier and existing Hono preview acceptance; preserve WebAssembly streaming ceiling.
- Retire ADR-0158 body wrappers and ADR-0529 Request/Response holds — owner: agent — superseding ADR + lifecycle carrier.

## Out of scope

- ADR-0529 classes that are real host I/O (Blob reads, WebAssembly, SubtleCrypto,
  WebSocket, BroadcastChannel) — unchanged.
- Server transport, WebSocket/EventSource implementation, new bundle limit.
