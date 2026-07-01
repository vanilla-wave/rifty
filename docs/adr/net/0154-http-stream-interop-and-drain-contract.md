# ADR 0154: HTTP stream interop and drain contract

Status: Accepted
Date: 2026-06-18

Correction 2026-06-29: `Readable.toWeb()` is now implemented as the narrow
Node Readable → WHATWG ReadableStream bridge. It preserves emitted chunk
identity/type, forwards the supplied strategy, and destroys the source on
reader cancel. `Writable.toWeb()` and full `node:stream/web` remain unclaimed.

## Context

Two Effect-shaped HTTP paths were still provisional after ADR-0054:
`ServerResponse` `'drain'` emission and
`Readable.fromWeb(webStream).pipe(res)`. Both are normal Node consumption
patterns, and leaving either as a backlog item made streaming responses look
less stable than the tested implementation.

## Decision

- `ServerResponse.write()` keeps its existing return widening
  (`boolean | Promise<boolean>`) and also emits Node-style `'drain'` after a
  prior backpressured write, gated by `_needDrain`.
- `@riftydev/io.Readable.fromWeb()` converts a WHATWG `ReadableStream` into a
  Node-shape `Readable`, preserving chunk boundaries and respecting `push()`
  backpressure.
- `Readable.pipe()` accepts writable sinks whose `write()` returns a Promise
  and pauses the source until it resolves. This makes `ServerResponse` a valid
  pipe target without an Effect-specific adapter.
- Full `node:stream/web` and `Writable.toWeb()` remain unclaimed until
  implemented and tested.

## Consequences

- Effect's web-stream response path can use the normal Node API:
  `Readable.fromWeb(body).pipe(res)`.
- The stream compat matrix claims `Readable.fromWeb` and `Readable.toWeb`
  only, not the whole WHATWG bridge surface.
- Backpressure remains JS-stream backpressure, not OS/socket throughput.

## Tests

- `packages/io/src/streams/readable.from.test.ts`
- `packages/net/src/http/response.test.ts`
- `tools/node-parity-runner/cases/http/server-streaming-drain.case.ts`
