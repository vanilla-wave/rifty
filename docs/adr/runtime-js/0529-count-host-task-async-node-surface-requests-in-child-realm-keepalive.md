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
   toolchain worker. Wrappers are Proxies on the realm's own functions
   (name/length/`toString` preserved); the observer branch never adds an
   unhandled rejection.
2. Counted, one ref per pending request, released on settle (fulfil or reject):
   - `Blob.prototype.arrayBuffer/bytes/text` (covers `buffer.Blob`, `File`,
     `fs.openAsBlob` results); `Blob.prototype.stream()` returns a byte stream
     whose each pending read holds — an unread stream holds nothing, as in Node.
   - `WebAssembly.compile`, `WebAssembly.instantiate` (both overloads).
     Streaming variants stay the ADR-0158 loud ceiling.
   - Every `SubtleCrypto.prototype` method (one prototype covers
     `globalThis.crypto.subtle`, `require('crypto').subtle`, `webcrypto.subtle`).
   - `Response`/`Request` body consumers (`arrayBuffer/blob/bytes/formData/json/text`)
     and `body` stream reads, only for host-backed bodies: constructed with a
     non-stream body, `Response.json()`, `new Request(hostBackedRequest)`, or
     `clone()` of one. A guest `ReadableStream` body settles on guest work and
     holds nothing (Node exits with such a read pending). Fetched responses
     stay ADR-0158's.
   - Global `WebSocket`: ref at construction, released on its `close` event
     (always dispatched after error or close).
3. Not counted, settle on microtasks with no host task: `fs.promises`/fs
   callbacks (sync RPC), `node:zlib` over CompressionStream (Chromium transforms
   synchronously; 64 MiB one-shot + stream rows pass unheld).
4. Out of the Node surface, not counted: `indexedDB`, `caches`,
   `navigator.locks`, `scheduler`; `EventSource` (not a default Node 24 global).
5. A never-settling counted request (unclosed WebSocket, never-read host body
   read pending forever) holds to the loud ADR-0152 §4 cap, as Node holds the
   process forever. Every counted class here has an observable release; none
   needs a refuse-by-name ceiling.

## Consequences

- (+) Run-to-completion programs whose last work is one of these requests print
  Node's result and exit status (browser-unit parity vs live Node).
- (+) ADR-0152 §1 shape unchanged; the named set grows by these classes.
- (−) `Response`/`Request` globals are Proxies: `Response.prototype.constructor
  !== Response` in the child realm.
- (−) A body built from a guest stream that itself waits on uncounted host work
  is held only by that work's own ref (same as Node's chain of handles).
