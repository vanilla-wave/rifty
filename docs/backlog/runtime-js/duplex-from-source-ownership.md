---
area: runtime-js
status: draft
title: Duplex.from direct iterable source ownership
created: 2026-07-12
why: Duplex.from bridges an eager intermediate Readable instead of owning one cold iterable source like Node
user_story: As a CLI wrapped with Duplex.from, I want demand and cancellation to reach my generator directly without a second buffer or leaked iterator.
blocked_by: [runtime-js/readable-from-iterator-lifecycle]
sources: [docs/adr/runtime-js/0238-readable-from-defaults-to-object-mode.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/duplex.ts]
---

## Context

Node runs its iterable adapter directly on Duplexify with object mode and a
disabled writable side. Rifty creates `Readable.from`, attaches `data`, then
pushes into a second Duplex buffer. That starts the source eagerly and splits
demand, HWM, error, and iterator teardown across two state owners.

## Acceptance

- Iterable/string/Buffer/Promise/async-iterable sources are cold until demand
  on the returned Duplex and use one readable buffer/state owner.
- Special sources use HWM 16; generic sources HWM 1; object mode stays true.
- Break/destroy/error own iterator teardown through the shared lifecycle seam.
- Writable-disabled state and public events match Node v24 on one SHA.

## Parity cases

1. Cold sync/async source; exact next counts at HWM 1.
2. Bare string/Buffer atomic identity and HWM 16.
3. Consumer break, destroy(error), and pending async next cleanup.
4. No intermediate listeners/buffer; writable-disabled state matches Node.

## Out of scope

- Pair, WHATWG, and body-function branches.
- Core byte-mode chunk admission.

## Decisions

Build on the refined `Readable.from` iterable-source owner; no event bridge.
