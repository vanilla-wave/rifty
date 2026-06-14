---
area: net
status: active
title: Stream http.request bodies (client buffers whole body, collapses chunk boundaries)
created: 2026-06-12
why: req.write() chunks are accumulated and sent as one Blob at end() — uploads/SSE-style request bodies cannot stream, chunk boundaries are not observable server-side, and write() backpressure is fake (always true)
user_story: As a developer doing `http.request` chunked uploads, I want each `req.write()` chunk to reach the server with its boundary intact and real `write()` backpressure — but today every chunk is buffered and sent as one `Blob` at `end()`, so streaming request bodies are impossible and backpressure always reports true.
sources: [PR #21 review, ADR-0017]
code: [packages/net/src/http/server.ts]
---

## Context

`request()` buffers every `write()` chunk in memory and dispatches once at `end()` via
`new Blob(chunks)`. The response direction already streams (ReadableStream). Symmetric
request streaming needs a ReadableStream body + duplex:'half' on the Request/fetch path,
which the in-process dispatch supports but host `fetch` egress only partially (browser
support for request streaming is limited).

## Options or Next

- In-process route: build the Request with a ReadableStream fed by write()/end — exact
  chunk boundaries, real backpressure via desiredSize.
- fetch egress: keep buffering (browser limitation), document divergence.

## Reversibility

REVERSIBLE — internal client mechanics; `write()/end()` surface unchanged.
