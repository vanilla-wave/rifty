---
area: runtime-js
status: draft
title: Writable.toWeb/fromWeb + Duplex.toWeb/fromWeb
created: 2026-06-28
why: the write/duplex half of the Node↔WHATWG bridge is absent; Readable.fromWeb/toWeb prove the read half, these complete it (pure-JS over Chromium WritableStream)
user_story: As a dev running a lib that does `Writable.fromWeb(webWritable)` to sink into a Web stream or `Duplex.toWeb(d)` to expose `{readable, writable}` to a Web API, I want them to work, but today only the Readable side bridges.
epic: whatwg-stream-bridge
sources: [ADR-0154, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## Context

`Writable.toWeb`/`fromWeb` and `Duplex.toWeb`/`fromWeb` are absent. `Readable.fromWeb`/`toWeb` (the read half) are the pattern. All pure-JS over Chromium `WritableStream`.

## Clear path (resolve at refine)

- `Writable.toWeb(w)` → a `WritableStream` whose `write(chunk)` calls `w.write` and AWAITS `'drain'` (backpressure); `close` → `w.end`; `abort` → `w.destroy`.
- `Writable.fromWeb(ws)` → a Node `Writable` whose `_write` pumps to `ws.getWriter().write`; `_final` → `writer.close`; `_destroy` → `writer.abort`.
- `Duplex.toWeb(d)` → `{ readable: Readable.toWeb(d), writable: Writable.toWeb(d) }`; `Duplex.fromWeb({readable, writable})` composes `Readable.fromWeb` + `Writable.fromWeb`.
- **Forks to settle:** error-propagation direction across the pair (a web-side abort vs a Node-side destroy — which wins, and the resulting error shape); whether `Duplex.toWeb` half-closes independently (Node allowHalfOpen semantics); exact `'drain'`/`desiredSize` backpressure mapping. Each becomes a parity case before flip.

## Reversibility

REVERSIBLE — additive pure-JS adapters over host WHATWG streams; no ADR (ADR-0154 leaves the surface unclaimed); CHANGELOG line + compat ✅ flips on completion.
