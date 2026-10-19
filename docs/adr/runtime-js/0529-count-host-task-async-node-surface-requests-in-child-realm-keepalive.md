# ADR 0529: Count host-task-async Node-surface requests in child-realm keepalive

Status: Accepted
Date: 2026-10

> TL;DR: Extends ADR-0152 §1's counted set: a pending host-task-async request of a Node-surface API (Blob/File body reads, WebAssembly compile/instantiate, SubtleCrypto, in-guest Body consumers) holds one keepalive ref until it settles; a global `WebSocket` holds one until its `close` event, a `BroadcastChannel` until `close()` — per-class refs on the existing `ref()/unref()` chokepoint, no realm-wide census (ADR-0378). Only holds exact by construction ship; native-internal body reads and `navigator.locks` are declared gaps.

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
     held stream; FormData is encoded by a native Response right after the init
     conversion (native extraction order), and the content type native
     extraction sets is kept. `body`, locking, `clone()` and the consumer
     methods stay native on it.
   - Every Body consumer (`arrayBuffer/blob/bytes/formData/json/text`) of an
     in-guest `Response` or `Request`, its clones and `Response.json()`:
     Chromium settles each on a host task, even over an in-memory string (one
     task; a cloned body's tee takes 15 for `Response.json({a:1}).clone()`,
     ~2k for 16 MiB). Not over a guest `ReadableStream` body: it waits on guest
     work, and Node exits with such a read pending. `clone()` and
     `new Request(request)` carry that kind.
   - An in-guest `Request` with a Blob/File body reads it synchronously
     (`FileReaderSync`, dedicated workers) into the same bytes with its content
     type, so its `body` stream needs no host task. Other bodies stay native;
     `init` is observed through a separate Proxy target (frozen inits stay
     valid), `init.body` read once.
   - `WebAssembly.compile`, `WebAssembly.instantiate` (both overloads).
     Streaming variants stay the ADR-0158 loud ceiling.
   - Every `SubtleCrypto.prototype` method (one prototype covers
     `globalThis.crypto.subtle`, `require('crypto').subtle`, `webcrypto.subtle`).
   - Global `WebSocket`: ref at construction, released on its trusted `close`
     event (always dispatched after error or close); the listener goes through
     the native `EventTarget` API, so a subclass override never runs before its
     constructor, and a synthetic `close` releases nothing.
   - Global `BroadcastChannel`: ref'd from construction until `close()`, as in
     Node; Node's `ref()`/`unref()` (absent natively) toggle the hold and
     return the channel, `ERR_INVALID_THIS` off a channel. rifty's own channels
     (net cross-realm/ws/port channels, owner bridges) open the native
     constructor the wrapper parks under `Symbol.for('rifty.host.BroadcastChannel')`
     (`openHostBroadcastChannel`, `@riftydev/io`): infrastructure never holds a
     guest loop.
   Only holds exact by construction are admitted: a host-API promise held to
   settle, the pull of a JS stream over a host source, a handle with an
   observable release, or synchronous materialization. A hold that emulates a
   native stream or fetch algorithm from outside is refused (seven review
   rounds each found a new observable divergence in one).
3. Not counted, settle with no host task (host-task count 0, deterministic
   row `uncounted Node-surface work settles with no host task`):
   `fs.promises`/fs callbacks (sync RPC), `node:zlib` over CompressionStream
   (Chromium transforms within the task), `body` stream reads of uncloned
   string, bytes and string-only FormData bodies.
4. Declared gaps (compat ❌), Node-surface but no exact outside hold:
   - `body` stream reads Chromium performs internally — either branch after
     `clone()`, a Request whose FormData body holds a Blob/File — and Body
     consumers over a guest-stream body. Kill condition: Node's own JS Fetch
     classes in the guest (`backlog/epics/node-fetch-classes-in-guest`).
   - `navigator.locks`: acquisition and release are host IPC, and Node exits
     with a request queued behind a never-released lock, so no outside hold
     matches (`backlog/runtime-js/navigator-locks-node-lifetime`).
   Out of the Node surface, not counted: `indexedDB`, `caches`, `scheduler`
   (absent in Node 24); `EventSource` (not a default Node 24 global).
5. A never-settling counted request (an unclosed WebSocket or ref'd
   BroadcastChannel) holds to the loud ADR-0152 §4 cap where Node holds the
   process forever. Every counted class
   has an observable release; none needs a refuse-by-name ceiling.

## Consequences

- (+) Run-to-completion programs whose last work is one of these requests print
  Node's result and exit status (browser-unit parity vs live Node).
- (+) ADR-0152 §1 shape unchanged; the named set grows by these classes.
- (−) A held promise settles one microtask after the native one — every Body
  consumer of an in-guest Response/Request included.
- (−) A Blob-bodied in-guest `Request` copies its bytes at construction.
- (−) Explicit gaps (compat ❌ rows in `docs/public/compat/process.md`):
  native-internal body reads (§4) and `navigator.locks`.

## Corrections

- 2026-10-20 — ADR-0541 replaces native Request/Response constructor/consumer
  holds and the native-body gap (§2/§4) with Node's JS classes; real Blob I/O
  remains held. Other host API classes and navigator.locks are unchanged.

- 2026-10-16 — §3 had claimed string, bytes, URLSearchParams, JSON and
  string-only FormData bodies settle on microtasks (64 MiB probes passed
  unheld): false — every Body consumer takes a host task and `clone()` tees
  over many (`Response.json({a:1}).clone().json()` was lost: RED row
  `response-json-clone`); the probes passed on drain timing only. Consumers
  are now held (§2); §3 keeps only host-task-count-0 classes. §4 had listed
  `navigator.locks` as outside the Node surface: false on Node 24.16.0 (a
  global); now a declared gap. The FormData-with-Blob Request stream body,
  its `fetch(request)` restore and the keepalive/no-cors carve-out are removed
  (an emulated stream body diverged from native fetch normalization, R7); that
  Request keeps its native body, its consumers held.
