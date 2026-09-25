# ADR 0447: Count referenced MessagePorts in child-realm keepalive

Status: Accepted
Date: 2026-09

> TL;DR: Node realms give native `MessagePort`s Node's manual reference API (`ref`/`unref`/`hasRef`). A referenced port holds one ADR-0152 keepalive ref until the port is unref'd or either end of its pair is closed. Pairs are recorded when the guest calls `MessageChannel`. A release rifty cannot observe is refused by name: a transfer that would move a referenced port, or its peer, out of view, or `ref()` on a port whose pair has already been split. The browser gives no close or detach signal, and the terminal `node` drain has no cap, so an unobserved release would hang forever. Adds a handle class to ADR-0152 §1, as ADR-0158 did.

## Context

`@emnapi/runtime` 1.10.0 (`dist/emnapi.cjs.js:1182-1205`) holds Node open while
napi async work is pending, using `new MessageChannel().port1`. It calls
`ref()` when the count goes 0→1 and `unref()` when it goes 1→0, but only if
those methods exist. Rolldown's wasm32-wasi binding unrefs its own pool Workers
(`rolldown-binding.wasi.cjs:64-90`), so this port is the only holder in Node.
Chromium ports have no `ref`, so the call is skipped and a rifty child drains
while rolldown work is still pending. Real Node shows the same symptom if only
the global ports lose `ref`/`unref`/`hasRef`: `vitest run` exits 0 with empty
output, and a detached rolldown build prints nothing. Evidence:
`docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md`.

What constrains the design (same evidence): Chromium 148 has no MessagePort
`close` event and no way to ask whether a port was detached (a neutered port's
`postMessage`/`close` are silent no-ops). The terminal `node <file>` drain runs
with `capMs: Infinity` (`packages/workbench/src/workers/node-entry-bootstrap.ts`,
the `awaitDrain` in the serve branch). A referenced port whose release cannot
be seen would therefore hang forever, where Node exits. That is not an honest
fault outcome (`docs/process/rules/fault-classes.md`).

Independent DEC-2 decision review, 2026-09-25: justified-with-fixes; the
ADR-0152 §1 extension now carries a dated note in ADR-0152 and a dated README
§Corrections row.

## Decision

1. **Local pairs.** In Node child realms, the global `MessageChannel` becomes a
   `Proxy` of the native constructor, and `node:worker_threads` exports the same
   object. It records each new pair (port → peer) and returns the native channel
   unchanged. Port and channel identity, `instanceof`, `.constructor`, `name`
   and `length` stay native. It is installed with the other realm-compat shims
   (pre-entry, before guest code runs) and skipped when the realm already has
   `MessagePort.prototype.ref` (the Node host). A second bundle reuses the same
   realm-wide state. Rifty's own channels created after the install are also
   recorded. That is harmless, because rifty never calls `ref()`.
2. **Handle class.** `ref`/`unref`/`hasRef` go on `MessagePort.prototype`
   (enumerable methods, as in Node). Each port has one referenced flag. `ref()`
   sets it and adds one keepalive ref; `unref()` clears it and releases that ref.
   Repeated calls change nothing, and a port never releases a ref it does not
   hold. They return `undefined`, and a non-port receiver throws
   `TypeError: Illegal invocation`. A fresh port is unreferenced.
3. **Close releases the pair.** The `close()` wrapper calls the native close and
   then marks both ends of the recorded pair closed, releasing their refs. This
   matches Node, where closing either end closes both. `ref()` on a closed port
   does nothing.
4. **No release after a transfer.** One transfer check covers every entry point
   that can move a port: `MessagePort.prototype.postMessage`, `structuredClone`,
   `Worker.prototype.postMessage` and the realm's global `postMessage`. It reads
   the transfer argument once (the sequence, or the options `transfer` member),
   builds an array from it, and passes that array to the native call (options
   go as an object inheriting the caller's, so Chromium reads any other member,
   such as `includeUserActivation`, from it once). The return value is the
   native one. If a referenced port, or the peer of one, is in the list, the
   call throws `NotImplementedError('MessagePort.transfer.referenced')` before
   anything is detached. After a successful transfer, each recorded port that
   moved is closed here, as Node closes a transferred source; its pair is now
   split. A zero-length probe buffer rides in the list to tell whether anything
   moved, because Chromium silently drops a transfer posted through a closed
   port. `ref()` throws `NotImplementedError('MessagePort.ref.transferred')` on
   the kept end of a split pair, and on a port it did not record (for example,
   one received through a transfer). Every other transfer stays native.
5. Emnapi, rolldown and vitest are not changed. Listeners, `start()` and message
   delivery are not wrapped.

## Explicit gaps

Each gap is a named throw, or is listed in `docs/public/compat/process.md`:

- **Moved or received ports cannot be referenced.** Node lets you transfer a
  referenced port and ref the other end or the copy. Rifty throws the §4 named
  errors instead.
- **Listener referencing.** In Node, adding a `'message'` listener (including
  `onmessage`) refs and starts the port, and removing the last one unrefs it.
  Rifty listeners never reference a port. This was already the case before this
  ADR. `hasRef()` reports only the manual flag. If the last ref is dropped while
  messages are still queued, those messages are not waited for. Node's listener
  hold would wait for them.
- **NodeEventTarget surface.** Ports have no `on`/`once`/`off`/`emit`
  (`addListener`, `removeListener`, `removeAllListeners`, `eventNames`,
  `listenerCount`, `setMaxListeners`, `getMaxListeners`), and no `'close'` event
  fires. Calling one of these methods is a `TypeError`. This was already the case.
- **Close timing.** After `close()`, Node's `hasRef()` stays `true` until its
  close-callback phase, and `ref()` can still set it in that window. Rifty's
  returns `false` at once. The program ends at the same point in both.
- **Reflection.** `Function.prototype.toString` on `MessageChannel` and on the
  wrapped methods shows the Proxy/wrapper, not native code.

## Rejected

- Patching emnapi, rolldown or vitest: package-shaped, and against the goal's
  generic-handle rule (vitest-run-in-browser goal §Decisions).
- Prototype methods with no pair record (own `unref`/`close` only). A
  referenced port whose peer closes would hang the terminal drain forever,
  which Node never does.
- Draft PR #351: every guest port untransferable, emulated close events,
  pending-message counting, and a `postMessage` wrapper that lost its return
  value and broke rifty's BroadcastChannel. It is broader than the forcing
  counter needs. Here the refusal covers only referenced pairs, and the return
  value is kept.
- Listener referencing on recorded pairs. Kernel channels created after the
  install are recorded too, so their listeners would start holding the realm,
  unless the kernel moved to a pinned primordial constructor (a new
  cross-package seam). I4 doesn't need it.

## References

- ADR-0152 (drain model, §1 handle set, §4 cap), ADR-0158 (precedent: widened set)
- `packages/runtime-js/src/internal/event-loop-keepalive.ts`
- `docs/backlog/runtime-js/message-port-ref-keepalive.md`
