# Map — node-fetch-classes-in-guest

## Items

1. `runtime-js/node-fetch-guest-carrier` — acceptance carrier — real Hono + Node/Chromium body, lifecycle and network differential cases.

## Open questions

None. Source/platform bindings and superseded lifecycle decisions: ADR-0541;
real HTTP, production, packed consumer and Hono preview carriers passed.

## Out of scope

- ADR-0529 classes that are real host I/O (Blob reads, WebAssembly, SubtleCrypto,
  WebSocket, BroadcastChannel) — unchanged.
- Server transport, WebSocket/EventSource implementation, new bundle limit.
