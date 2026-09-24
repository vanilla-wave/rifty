# ADR 0448: Carry advanced fork IPC as a native structured clone

Status: Accepted
Date: 2026-09

> TL;DR: `fork(..., { serialization: 'advanced' })` sends each message as the
> realm's native structured clone over ADR-0326's existing public-IPC lane. One
> codec module applies Node's v8-serializer rules where the browser clone
> differs: every ArrayBuffer view becomes its own copy of exactly its bytes,
> `Buffer` keeps its brand, SharedArrayBuffer and V8-refused values throw
> Node's plain `Error`, and the rest are named throws. node-entry goes v4 → v5
> to carry `ipc: 'advanced'`. Partially overturns ADR-0326's "advanced IPC
> serialization remains a directed loud gap".

## Context

vitest 4.1.11's default `forks` pool calls `fork(entry, [], { env, execArgv,
stdio: 'pipe', serialization: 'advanced' })`. Its birpc frames carry
`undefined` members/arguments and circular task graphs (JSON would drop the
first and throw on the second). rifty throws at spawn. Oracle, Chromium probe
and vitest traffic: `docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`.

Node's advanced serializer is V8's `ValueSerializer` plus Node's host-object
hooks (`lib/v8.js` `DefaultSerializer`, `lib/internal/child_process/serialization.js`).
Chromium's `structuredClone`/`postMessage` is the same V8 serializer plus
Blink's hooks. They agree on intrinsic types, Error mapping, getter order and
refusal text. They differ in four places (evidence §Chromium):

1. ArrayBuffer views: Node copies only the view's bytes (so views never share
   memory and never expose the rest of their buffer) and sends a view whose
   `constructor` is `Buffer` as a `Buffer`. The browser clones the whole
   backing buffer (Buffer → `Uint8Array`) and shares SharedArrayBuffer memory.
2. A bare SharedArrayBuffer: Node refuses it (`#<SharedArrayBuffer> could not
   be cloned.`); the browser shares it.
3. Refusals: Node throws a plain `Error` with V8's text; the browser throws a
   `DOMException` `DataCloneError` whose message has a `Failed to execute …: `
   prefix.
4. Platform objects (`Blob`, `File`, `DOMException`, `URL`, `AbortController`,
   `Headers`, `MessagePort`, `WebAssembly.Module`, …): Node's serializer writes
   most as plain objects of their own enumerable properties (a `DOMException`
   arrives as a message-less `Error`; a wasm module crashes the receiver); the
   browser clones some and refuses others with Blink's text.

## Decision

1. **Option and launch.** `serialization` accepts `undefined`, `'json'` or
   `'advanced'`; anything else is Node's `TypeError`
   `ERR_INVALID_ARG_VALUE`, in `fork` and plain `spawn` alike. A plain spawn
   otherwise ignores it (no IPC). A fork with `'advanced'` launches its child
   with `ipc: 'advanced'`. That widens the program launch, so under ADR-0267's
   version rule `rifty.node-entry/v4` becomes `v5` atomically, with no v4
   reader (ADR-0416 precedent). JSON serialization itself is unchanged.
2. **One codec, every site.** One module encodes at every advanced send (parent
   Worker route, parent same-realm route, child `process.send`) and decodes at
   every advanced receive. The existing channel, frames, order, disconnect and
   exit handling are reused; no new coordination mechanism.
3. **Encode.**
   - Top-level validation is shared with JSON (`ERR_MISSING_ARGS`,
     `ERR_INVALID_ARG_TYPE` with Node's `Received …` text, which the JSON path
     gains too).
   - `structuredClone(message)` in the sending realm. V8 decides traversal,
     getters (once, in order), refusals, and every intrinsic type.
   - A `DataCloneError` carrying V8's own text (`<x> could not be cloned.`,
     never Blink's `<Interface> object could not be cloned.`), with any
     `Failed to execute …: ` prefix removed, becomes Node's plain `Error` with
     that text; a detached-buffer refusal
     is `NotImplementedError('child_process.serialization.advanced.detached-array-buffer')`
     (Node words a detached buffer and a view over one differently, and the
     browser does not tell them apart); any other refusal text (Blink's
     platform-object forms, the Node host's own) is the host-object throw
     below. Any other thrown value (a getter's own error) propagates unchanged.
   - Walk the clone, which is plain data with no getters or proxies. A
     SharedArrayBuffer throws Node's plain `Error`. An object whose prototype is
     not one V8 itself deserializes (`Object`, `Array`, `Date`, `RegExp`, `Map`,
     `Set`, the seven Error prototypes, `ArrayBuffer`, the typed arrays,
     `DataView`, the four primitive wrappers) is
     `NotImplementedError('child_process.serialization.advanced.host-object')`.
     Every ArrayBuffer view becomes a fresh copy of exactly its bytes: the same
     view reached twice stays one copy; Map keys and Set members are rebuilt in
     order.
   - `Buffer` brand, only when the clone holds a view: walk the original
     message beside the clone along the own enumerable properties, Map and Set
     entries and Error `cause` that V8 traversed, and read each view's
     `constructor` once, as Node's `_writeHostObject` does. A view whose
     `constructor` is `Buffer` arrives as a `Buffer` of its bytes. If that walk
     meets an own accessor, or a graph that no longer matches the clone, the
     brand is unknowable: `NotImplementedError('child_process.serialization.advanced.accessor-with-view')`.
   - The frame payload is `[value, buffers]`; `buffers` lists the copies to
     brand. Object identity inside one message survives `postMessage`.
4. **Decode.** Give each listed copy the receiving realm's `Buffer` prototype
   and deliver `value`.
5. **Keepalive.** A fork child's IPC lane holds the realm while it has a
   `'message'` listener in both serializations (Node's channel ref), as the
   JSON lane already does. A launch-less URL Worker that shares the physical
   port stays unheld (draft PR #349 held it and kept the Workbench owner
   alive). Node also refs the channel for a `'disconnect'` listener; rifty
   does not on either serialization: a recorded discovery (REV-12).

## Not claimed

A received view owns its bytes (`byteOffset` 0, its own ArrayBuffer). Node's
view sits inside the per-message deserialization buffer at a wire-format offset,
shared with the message's other views (evidence §layout). That layout is
allocation policy, like Buffer pool offsets, and is not claimed.

## Explicit gaps

Named throws, listed in `docs/public/compat/process.md`:

- `…advanced.host-object`: a platform object in the message. Node sends most
  as a plain object of their own enumerable properties, a `DOMException` as a
  message-less `Error`.
- `…advanced.detached-array-buffer`: a detached ArrayBuffer, or a view over
  one. Node throws `Error` or `TypeError` respectively.
- `…advanced.accessor-with-view`: an own accessor on the traversal path of a
  message that holds an ArrayBuffer view. Node sends it.

Residuals (compat ⚠️), error paths only: the native clone continues past a
SharedArrayBuffer, where Node's serializer stops. A message holding a
SharedArrayBuffer and a later V8-refused value therefore names the refused value
(Node names the SharedArrayBuffer), and getters after the SharedArrayBuffer run.
The same holds for a host object before a later refusal. The `constructor` read
runs after the clone, not during it; only a `constructor` getter that mutates
the message could tell.

## Rejected

- **Raw passthrough** (draft #349): Buffer → `Uint8Array`, shared
  SharedArrayBuffer memory, the whole backing buffer exposed, `DOMException`
  instead of Node's `Error` (evidence §Chromium).
- **Hand-walked snapshot codec** (draft #351): re-deriving V8's traversal and
  brand checks needed global `Proxy`/`Function.prototype.toString` facades in
  every realm, promise-brand probes that mutated guest objects,
  a `NotImplementedError` on frozen records Node sends, and production bootstrap
  sealing that broke the owner build. The native clone gets V8's semantics for
  free.
- **Preflight walk plus ceilings** (draft #352): `Buffer` was a throw where Node
  keeps it, class instances Node sends as plain objects were a ceiling, and a
  `Reflect.ownKeys` walk saw keys V8 skips.
- **V8 wire format in JS** (exact `byteOffset` layout): a serializer
  reimplementation for a framing artifact (§Not claimed).

## Consequences

- vitest's forks pool gets Node's value semantics over the lane it already has.
- Deploy matching Worker assets together; a v4 child bundle rejects a v5 launch.
- DEC-2: corrects ADR-0326 (§Decision "Advanced IPC serialization … directed
  loud gaps": advanced serialization is now carried; handles, callbacks/options
  and channel `ref()`/`unref()` stay gaps; §One validated launch plan
  `ipc: 'none' | 'json'` widened to `'advanced'`) and ADR-0416's active v4
  version. Independent DEC-2 decision review, 2026-09-25: justified-with-fixes
  (launch-plan clause named here, in ADR-0326's dated note and the README
  §Corrections row).

## References

- ADR-0326, ADR-0267, ADR-0416, ADR-0152 (keepalive drain)
- `packages/runtime-js/src/internal/node-ipc-serialization.ts`
- `docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`
