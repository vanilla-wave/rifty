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
   - `blob.stream()` returns one JS byte stream over the native blob stream:
     every native consumer (readers, `for await`, `tee`, `pipeTo`,
     `pipeThrough`, `Readable.fromWeb`, a Response body) runs unchanged on it,
     and only its pull — a pending host read — holds. An unread stream, or a
     pipe waiting on a guest sink, holds nothing, as in Node.
   - A `Response` with a Blob/File or FormData body is built natively over that
     held stream (FormData encoded by a native Response first); the content type
     native extraction sets is kept. `body`, locking, `clone()` and the consumer
     methods stay native on it.
   - In-guest `Request` consumer methods (`arrayBuffer/blob/bytes/formData/json/text`)
     for Blob/File/FormData bodies, `new Request(blobBackedRequest)` and their
     `clone()`. `init.body` is observed during the native read, never read twice.
     The native body is kept: a stream body would change how `fetch(request)`
     sends it.
   - `WebAssembly.compile`, `WebAssembly.instantiate` (both overloads).
     Streaming variants stay the ADR-0158 loud ceiling.
   - Every `SubtleCrypto.prototype` method (one prototype covers
     `globalThis.crypto.subtle`, `require('crypto').subtle`, `webcrypto.subtle`).
   - Global `WebSocket`: ref at construction, released on its trusted `close`
     event (always dispatched after error or close); the listener goes through
     the native `EventTarget` API, so a subclass override never runs before its
     constructor, and a synthetic `close` releases nothing.
3. Not counted, settle on microtasks with no host task: `fs.promises`/fs
   callbacks (sync RPC), `node:zlib` over CompressionStream (Chromium transforms
   synchronously; 64 MiB one-shot + stream rows pass unheld), string, bytes,
   URLSearchParams, JSON and string-only FormData bodies (64 MiB probes settle
   unheld on `aebdd7ddd`).
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
- (−) Explicit gap: reading the `body` stream of an in-guest blob-backed
  `Request` directly (reader, `for await`, pipe) holds nothing; its consumer
  methods do. Compat ❌ row in `docs/public/compat/process.md`.
