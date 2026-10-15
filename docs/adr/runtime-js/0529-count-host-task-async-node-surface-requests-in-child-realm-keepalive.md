# ADR 0529: Count host-task-async Node-surface requests in child-realm keepalive

Status: Accepted
Date: 2026-10

> TL;DR: Extends ADR-0152 §1's counted set: a pending host-task-async request of a Node-surface API (Blob/File body reads, WebAssembly compile/instantiate, SubtleCrypto, host-backed Response/Request bodies) holds one keepalive ref until it settles, and a global `WebSocket` holds one until its `close` event — per-class refs on the existing `ref()/unref()` chokepoint, no realm-wide census (ADR-0378).

## Context

libuv counts a pending threadpool/platform request as an active handle, so
Node prints the result of `await blob.arrayBuffer()`, `WebAssembly.compile`,
`crypto.subtle.deriveBits` or an open `WebSocket` after top level. In the child
realm these settle on a host task; nothing held a ref, so the ADR-0445
two-sample drain reaped the realm first — no output, no stderr, exit 0
(observed on `9645c62bf`, Node 24.16.0 baseline:
`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
§Probe 2/3; RED rows in `tests/browser-unit/host-async-keepalive.spec.ts`).
Precedents add one class each on the same seam: ADR-0158 (fetch), ADR-0446
(Worker), ADR-0447 (MessagePort).

## Decision

1. `installHostAsyncKeepalive()` (`packages/runtime-js/src/builtins/host-async-keepalive.ts`)
   runs beside `installFetchKeepalive()` in every kernel worker and the no-COI
   toolchain worker. Wrappers are Proxies on the realm's own functions:
   name/length kept, `Function#toString` reports the wrapped native text (one
   realm mask over the wrappers), `X.prototype.constructor === X`. A held call
   returns a settle-tracked copy of the native promise (settles one microtask
   later): an unobserved rejection stays unhandled, as in Node.
2. Counted, one ref per pending request, released on settle (fulfil or reject):
   - `Blob.prototype.arrayBuffer/bytes/text` (covers `buffer.Blob`, `File`,
     `fs.openAsBlob` results).
   - Reads of host streams — `blob.stream()` results and the native `body`
     of a host-backed Response/Request (identity and locking stay native):
     a pending `read()` of a reader (`getReader()` or a direct
     `ReadableStreamDefaultReader`/`BYOBReader` constructor; covers
     `stream.Readable.fromWeb`), async-iterator `next()`, reads of `tee()`
     branches. `pipeTo`/`pipeThrough` run the native pipe on a tap (options and
     destination validated first, in native order), lock the source once the
     tap is locked, and release it when the source ends, errors or the pipe
     cancels/settles; only the tap's pending host read holds, so a pipe waiting
     on a guest sink or transform holds nothing. An unread stream holds nothing,
     as in Node.
   - `WebAssembly.compile`, `WebAssembly.instantiate` (both overloads).
     Streaming variants stay the ADR-0158 loud ceiling.
   - Every `SubtleCrypto.prototype` method (one prototype covers
     `globalThis.crypto.subtle`, `require('crypto').subtle`, `webcrypto.subtle`).
   - `Response`/`Request` body consumers (`arrayBuffer/blob/bytes/formData/json/text`)
     for host-backed bodies: any non-stream body or a host stream,
     `Response.json()`, `new Request(hostBackedRequest)`, `clone()` of one.
     `init.body` is observed during the native read, never read twice. A guest
     `ReadableStream` body settles on guest work and holds nothing (Node exits
     with such a read pending). Fetched responses stay ADR-0158's.
   - Global `WebSocket`: ref at construction, released on its trusted `close`
     event (always dispatched after error or close); the listener goes through
     the native `EventTarget` API, so a subclass override never runs before its
     constructor, and a synthetic `close` releases nothing.
3. Not counted, settle on microtasks with no host task: `fs.promises`/fs
   callbacks (sync RPC), `node:zlib` over CompressionStream (Chromium transforms
   synchronously; 64 MiB one-shot + stream rows pass unheld).
4. Out of the Node surface, not counted: `indexedDB`, `caches`,
   `navigator.locks`, `scheduler`; `EventSource` (not a default Node 24 global).
5. A never-settling counted request (an unclosed WebSocket) holds to the loud
   ADR-0152 §4 cap where Node holds the process forever. Every counted class
   has an observable release; none needs a refuse-by-name ceiling.

## Consequences

- (+) Run-to-completion programs whose last work is one of these requests print
  Node's result and exit status (browser-unit parity vs live Node).
- (+) ADR-0152 §1 shape unchanged; the named set grows by these classes.
- (−) A held promise settles one microtask after the native one.
- (−) `pipeThrough(…, { preventCancel: true })` from a host stream whose
  transform errors leaves the source locked by the tap, where the native pipe
  releases it.
- (−) A host stream consumed only through a native internal reader (e.g. passed
  to `new Response(stream)` and read there) is covered by that body's consumer
  hold, not per read.
