# ADR 0086: optional dispatchStruct on CrossRealmPortHandler

Status: Accepted
Date: 2026-06

> TL;DR: add optional typed `dispatchStruct({url,method,headers,body})` to `CrossRealmPortHandler` so the Real-Vite preview path skips Request rebuild + arrayBuffer() drain; PortHandler(Request)/dispatchToPort contract untouched (additive opt-in)

## Context

Real-Vite preview request path: SW posts a `SerializedRequest`
(`{port,url,method,headers,body}`) → page → worker. The page-side
`mountPlaygroundPreviewBridge` rebuilt a `Request` from it (copying `req.body`
into an ArrayBuffer) then called `dispatchToPort(Request)`; `bridgeCrossRealmPreview`'s
handler then re-drained that Request via `await request.arrayBuffer()` to get the
bytes back for the page→worker frame. Per request on the hot preview path:
one Request construction + one body copy + one `arrayBuffer()` drain — all to
re-derive fields the SW already decoded (perf-audit 2026-06-05 #21/#19).

Question: how to skip the Request rebuild + drain without breaking the public
`PortHandler(Request)` contract.

## Decision

Add an OPTIONAL typed method `dispatchStruct({url,method,headers,body})` to the
`CrossRealmPortHandler` interface (a sub-interface of `PortHandler`). It posts
the same page→worker wire frame as `handler(Request)` but takes the already-decoded
struct, so it builds no Request and runs no `arrayBuffer()` drain. Both
entrypoints share one private `post(method,url,headers,bodyBytes)` core, so the
frame, timeout, and reply/stream handling stay identical.

The page-side wiring threads the typed `previewBridge` handle into
`mountPlaygroundPreviewBridge`; with a handle it calls `dispatchStruct`, without
one (mock dev-server path, a bare `PortHandler`) it falls back to
`dispatchToPort(Request)`. One shared function, not a fork.

Options:
- **A — optional `dispatchStruct` handle (CHOSEN).** Additive; the public
  `PortHandler(Request)` / `dispatchToPort(Request)` contract is untouched.
  Callers holding a typed `CrossRealmPortHandler` opt in; everyone else keeps Request.
- B — widen `dispatchToPort` / `PortHandler` to accept a struct (REJECTED).
  Changes public API between packages (Reversibility rule 1, IRREVERSIBLE) and
  forces every port handler (mock dev-server, future SW handlers) to grow a struct
  path. The win is reachable additively, so the breaking option is unjustified.

## Consequences

- Real-Vite request path drops one Request construction + one ArrayBuffer body
  copy (page-side wiring) + one `arrayBuffer()` drain (preview-port handler).
- `PortHandler(Request)` / `dispatchToPort` contract unchanged; mock dev-server
  path keeps the Request fallback verbatim.
- `dispatchStruct` is byte-identical to `handler(Request)`: same frame, same
  post-dispose 502, GET/HEAD body dropped (the Request path never carries one).
- Worker side, frame shape, reply/stream handling untouched.
- Negative: `CrossRealmPortHandler` is now wider public surface (a second
  entrypoint to keep in lockstep with the Request path) — pinned by unit tests.
- Follow-up: M12 MessagePort rewrite (ADR-0017) may collapse both entrypoints.

## Acceptance criteria

- [x] `dispatchStruct` byte-identical to `handler(new Request(...,{body}))` for a POST body.
- [x] GET round-trip via `dispatchStruct` (null body, no `arrayBuffer()` drain).
- [x] After `dispose()`, `dispatchStruct` → 502.
- [x] A GET/HEAD body passed to `dispatchStruct` is dropped (frame.body === null).
- [x] `dispatchToPort` / `PortHandler(Request)` signature unchanged.
