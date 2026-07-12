# ADR 0237: Readable owns read-hook dispatch and demand latch

Status: Accepted
Date: 2026-07

> TL;DR: `Readable` dispatches one late-bound `_read`; core `push()` owns
> admission/refill, WHATWG adapters issue one cold pull per demand, and Writable
> decodes strings before HWM accounting.

## Context

ADR-0034 restored `read(n)` and `_readableState`, but the implementation kept
constructor `read` in private `readImpl`. That split Node's extension slot from
the dispatcher: subclass and post-construction `_read` are unreachable,
`finally` releases `reading` before a producer pushes, and sync throws escape
`read()`. WHATWG adapters spread caller options into internal constructors,
observing hook getters Node ignores and allowing two hook authorities. Core and
adapter paths disagree on zero-size chunks, Buffer brand, synchronous reads,
and writable `decodeStrings` accounting.

## Decision

- Constructor `read` becomes own `this._read`; every demand path calls the
  current `this._read`, so instance option → subclass prototype → base follows
  normal prototype lookup.
- The base `_read` throws Node's `ERR_METHOD_NOT_IMPLEMENTED`. Push-fed sources
  install explicit hooks; bare streams stay loud. A `fromWeb` readable hook is
  real: one demand issues exactly one `reader.read()`.
- `Readable.push()` is the only admission boundary. Object mode preserves raw
  identity. Byte mode filters `undefined`, `''`, and empty Uint8Array; converts
  string/plain Uint8Array to Buffer; preserves input Buffer identity.
- Filtered pushes release demand without buffering. A private coalesced refill
  turn, never listeners or adapter waiters, continues flowing/`readable` demand
  while capacity remains. The latch permits one pending adapter read.
- `maybeRead` sets `reading`; only `push(data|null)` clears it. `_read`'s return
  is never observed. A sync throw destroys with the raw value and does not
  escape `read()`.
- Core Writable owns `decodeStrings`: byte-mode strings become Buffer before
  length/HWM accounting; `false` and object mode preserve the string.
- Each `fromWeb` adapter reads config once in Node order: Readable
  `highWaterMark,encoding,objectMode,signal`; Writable
  `highWaterMark,decodeStrings,objectMode,signal`; Duplex
  `allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark,signal`. Hook
  getters are never read. Public option types exclude hooks and `signal`;
  non-undefined runtime `signal` loud-throws its adapter feature key.

## Consequences

- One owner removes `readImpl`/`_read` sibling drift across paused, flowing,
  `readable`, and `wrap` demand.
- Cold web adapters do no read before demand and never install internal
  `data`/`readable` listeners.
- Subclass authors gain the Node extension point; bare `Readable` consumers now
  receive a loud error instead of an indefinite stall.
- Inline TypeScript calls passing hooks to `fromWeb` stop compiling; remove them
  because they never participate in Node's adapters. No compatibility shim:
  accepting or invoking them would preserve a false contract.
- WHATWG terminal reason/order/locks and `{ signal }` stay explicit in
  `runtime-js/web-stream-adapter-terminal-lifecycle`.
- Core Writable/Transform write-hook dispatch stays outside; string admission
  and adapter-owned hook exclusion are inside.

## Rejected

- Keep `readImpl` plus override probes: two hook authorities, same drift class.
- Await or inspect Promise/thenable returns: invents a protocol Node does not have.
- Adapter pull loops/waiters: create a second demand owner and alter stream mode.
- Keep a silent base `_read`: turns a missing implementation into a hang.
