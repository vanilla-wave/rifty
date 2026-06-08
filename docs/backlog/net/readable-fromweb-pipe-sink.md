---
area: net
status: parked
title: ServerResponse pipe-sink + @riftydev/io Readable.fromWeb (Effect web-stream response path)
created: 2026-06-08
why: Effect's Readable.fromWeb(body).pipe(res) path unsupported until Readable.fromWeb lands in @riftydev/io (no owner)
sources: [Q-2026-05-30-109, Q-2026-05-30-103, feature-05-effect-http-bridge T4]
---
## Context
Effect's `internal/httpServer.ts` uses `Readable.fromWeb(webStream).pipe(nodeResponse)` for FormData/web-stream response bodies. Two gaps: (1) `ServerResponse` is an `EventEmitter`, not a `Writable` `.pipe()` sink (Q-103 — addressed by widening `@riftydev/io` `PipeableWritable.write` return + a defensive `'error'` path, making `ServerResponse` a valid pipe TARGET); (2) `@riftydev/io.Readable` has NO static `fromWeb`, so the Effect web-stream-response path is unsupported until `fromWeb` lands (no owner). opencode's facade serves JSON/SSE, not FormData responses, so deferred behind a compat-matrix gap note.

## Options / Next
Q-109 prefers DEFER. Next (gated): implement `@riftydev/io Readable.fromWeb` only when a real route sends a FormData/web-stream response body; the `ServerResponse`-as-pipe-target half (Q-103) is bounded (defer if it would require extending `Writable`/touching the body machinery). Document the gap in docs/public/compat — Effect web-stream-response path = unsupported until `fromWeb`.

## Reversibility
REVERSIBLE (Q-103: additive duck methods + 1-line io return-type widen, ≤2 files). The `fromWeb` half is a deferred additive feature in @riftydev/io, no ADR conflict. The backlog item is this file (Q-2026-05-30-109/-103); parked behind verified need.
