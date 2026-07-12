---
area: runtime-js
status: ready
title: Readable read-hook and chunk-admission protocol
created: 2026-07-12
why: Readable splits _read dispatch, demand release, and byte admission across core and adapters
user_story: As a Node stream producer, I want one late-bound read hook and one push admission boundary so packages observe real Node demand, chunk types, and loud errors.
blocked_by: []
sources: [docs/adr/runtime-js/0237-readable-owns-read-hook-dispatch-and-demand-latch.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## User scenario

A Node-style producer subclasses `Readable`, a fetch body enters through
`fromWeb`, or a Writable receives strings; all observe one real Node protocol.

## Acceptance

- Every demand path dispatches one current `_read`; base missing hook loud-throws.
- `push()` alone releases demand and owns object identity, byte no-ops, Buffer
  normalization, HWM refill, EOF, and sync-throw destruction.
- Readable/Writable/Duplex web adapters are cold, ignore hook getters, read Node
  config once, and loud-throw non-undefined unsupported `signal`.
- Core Writable applies `decodeStrings` before byte-mode HWM accounting.
- Full direct/subclass/adapter parity and regressions pass on one SHA.

## Parity cases

1. Option/subclass/post-construction/base `_read`; sync return/throw; one latch.
2. Object/byte push of string, Buffer, plain/empty Uint8Array, `''`, undefined, EOF.
3. Paused/flowing/`readable` demand and HWM 0/1 refill.
4. All three fromWeb adapters: cold pull, option getter order, signal loud gaps.
5. Writable `decodeStrings` true/false/object mode before HWM accounting.

## Fault matrix

| Axis × operation | Honest outcome |
|---|---|
| `concurrent-same-key` × repeated demand while a web pull is pending | One core latch permits one `reader.read()`; later demand coalesces without a second pull |
| `observable-order` × filtered push versus queued refill | Admission releases the latch first, then schedules at most one refill; listeners never own demand |
| `unbounded-read` × EOF/destroy/sync throw racing scheduled refill | Terminal state neutralizes the refill, dispatches no later `_read`, and settles once |
| `sibling-drift` × option/subclass/direct/fromWeb demand | One shared contract suite proves the same hook, admission, and terminal ordering |
| `false-fallback` × non-undefined unsupported fromWeb signal | Validate config in Node order, then loud-throw the adapter feature key before any pull |

## Out of scope

- `Readable.from` source defaults and iterator lifecycle.
- Sized-read HWM projection; WHATWG terminal lifecycle.

## Decisions

Implement ADR-0237 through one core source owner; no adapter waiters or second latch.
