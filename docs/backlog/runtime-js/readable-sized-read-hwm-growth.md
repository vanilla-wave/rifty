---
area: runtime-js
status: draft
title: Readable sized-read high-water-mark growth
created: 2026-07-12
why: Readable.read(n) leaves highWaterMark below n instead of growing it like Node
user_story: As a stream consumer using sized reads, I want readableHighWaterMark and refill demand to match Node after requesting more than the configured capacity.
blocked_by: []
sources: [docs/adr/runtime-js/0034-io-streams-node-contract.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

Node raises the readable HWM when `read(n)` requests more than the current HWM;
for example, HWM 0 becomes 1 after `read(1)` in object and byte mode. It rounds
up to a power of two and passes the projected HWM to `_read`. Values through
1 GiB are accepted; larger `n` throws `ERR_OUT_OF_RANGE` without mutation.
Rifty never projects HWM. Byte mode passes raw `n` to `_read`; object mode uses
its current-headroom hint (minimum 1), independent of requested `n`.

## Acceptance

- Sized reads grow HWM with Node's exact validation, power-of-two rounding, and 1 GiB bound.
- Object/byte mode state, `_read(size)` hints, refill, EOF, and public HWM match.
- Direct Readable and adapter consumers pass the same parity matrix on one SHA.

## Parity cases

1. Object/byte × empty/buffered/ended/destroyed at HWM 0 with `read(1)`.
2. `read(0)`, `read()`, `n <= HWM`, `HWM+1`, non-powers, 1 GiB, and 1 GiB+1.
3. `_read` receives the projected HWM; partial data, EOF, and later refill agree.

## Out of scope

- `Readable.from` iterator teardown and exact iterator refill counts.
- Constructor/default HWM and byte-chunk admission.
- Writable HWM/needDrain.

## Decisions

Own HWM projection in core `Readable.read(n)`, never in individual adapters.
ADR-0034 currently says `_read(min(hwm,n))`; promotion to `ready` requires a
superseding ADR for that sized-demand clause.
