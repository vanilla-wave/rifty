---
area: runtime-js
status: draft
title: Writable public needDrain state
created: 2026-07-12
why: completion timing now matches Node but the writableNeedDrain projection remains absent
user_story: As a Node package inspecting Writable around write(), I want dispatch timing and need-drain state to match real Node.
blocked_by: []
sources: [docs/adr/runtime-js/0240-writable-completion-separates-internal-and-public-phases.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## Context

ADR-0240 now covers idle/queued/corked scalar and batch completion: internal
state settles before the public return, while drain/callback/error/finish effects
publish in Node order. Internal `needDrain` exists, but the read-only public
`writableNeedDrain` projection remains absent.

## Acceptance

- Add the read-only `writableNeedDrain` projection over the existing state.
- Its below/at/above-HWM transitions match Node for direct, queued, corked, and
  writev paths.
- Writable/Duplex sibling parity passes on one SHA.

## Parity cases

1. HWM return/needDrain below, at, and above threshold.
2. Queue/cork/writev plus sync completion, async error, and destroy.

## Out of scope

- String admission and WHATWG terminal lifecycle.

## Decisions

The projection is reversible and derives from the ADR-0240 state owner.
