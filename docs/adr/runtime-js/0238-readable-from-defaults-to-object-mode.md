# ADR 0238: Readable.from defaults to object mode

Status: Accepted
Date: 2026-07

> TL;DR: `Readable.from` defaults every source to object mode; bare strings and
> Buffers are one source entry, matching Node instead of inferring from data.

## Context

The existing adapter synchronously peeks a sync iterable and chooses byte mode
for string/Uint8Array entries. Node v24 always defaults `Readable.from` to
object mode. The inference also consumes one iterator step before demand and
splits bare strings/Buffers into their JavaScript iterator elements.

## Decision

- Build Node's defaults before spreading caller options: generic iterables get
  `{ objectMode: true, highWaterMark: 1 }`; bare string/Buffer gets
  `{ objectMode: true }`. An own caller value, including explicit `undefined`,
  overwrites that default exactly as Node's option spread does.
- Treat a bare string or Buffer as a one-entry iterable. Other sync/async
  iterables keep their own iterator boundaries; a bare Uint8Array therefore
  yields numeric object entries like Node.
- Create the iterator without peeking; only the readable demand loop calls
  `next()`. `Duplex.from` inherits this contract through its Readable delegate.

## Consequences

- Covered string/Buffer/plain-entry defaults preserve type, identity, and Node boundaries.
- Callers needing byte mode must pass `{ objectMode: false }`. This does not
  preserve rifty's former bare-source element iteration; callers relying on
  that behavior must pass an explicit iterable of the desired entries.
- Byte-mode chunk admission/validation is a separate core stream contract.
- Iterator terminal ownership remains
  `runtime-js/readable-from-iterator-lifecycle`; direct Duplex ownership remains
  `runtime-js/duplex-from-source-ownership`.

## Rejected

- Keep first-entry inference: faithless default and pre-demand side effect.
- Make every typed array atomic: Node special-cases Buffer, not plain Uint8Array.
