# Map — node-fetch-classes-in-guest

## Items

<!-- none seeded: the destination is unratified (goal.md draft) -->

## Open questions

- Source of the classes: Node's bundled undici (`internal/deps/undici`) vendored
  vs the `undici` npm package; a new runtime dependency → ADR — owner: agent at FIT.
- Bundle-size budget for the runtime worker chunk — owner: user at FIT.
- Which globals move (`Request`, `Response`, `Headers`, `FormData`, `fetch`;
  `WebSocket`/`EventSource` too?) and how native-only consumers
  (`WebAssembly.compileStreaming`, service-worker preview) convert at the
  boundary — owner: agent at FIT.
- Fate of ADR-0158's fetch wrapper and ADR-0529 §2 Response/Request holds once
  bodies are JS — owner: agent at FIT (superseding ADR).

## Out of scope

- ADR-0529 classes that are real host I/O (Blob reads, WebAssembly, SubtleCrypto,
  WebSocket, BroadcastChannel) — unchanged.
