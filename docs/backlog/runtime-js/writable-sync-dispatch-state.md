---
area: runtime-js
status: draft
title: Writable synchronous dispatch and public needDrain state
created: 2026-07-12
why: uncorked write defers _write to a microtask and omits writableNeedDrain, unlike Node
user_story: As a Node package inspecting Writable around write(), I want dispatch timing and need-drain state to match real Node.
blocked_by: []
sources: [docs/public/compat/streams.md]
code: [packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## Context

Rifty schedules the first uncorked write through a microtask. Node enters
`_write` before `write()` returns when idle. Internal `needDrain` exists, but
the public `writableNeedDrain` projection is absent.

## Acceptance

- Direct/queued/corked/writev sync and async paths match Node dispatch,
  callback, drain, error, and destroy order.
- `writing`, length, `writableNeedDrain`, and write returns match at each phase.
- Writable/Duplex sibling parity passes on one SHA.

## Parity cases

1. First async `_write` entered before return; `writing === true`.
2. HWM return/needDrain below, at, and above threshold.
3. Queue/cork/writev plus sync completion, async error, and destroy.

## Out of scope

- String admission and WHATWG terminal lifecycle.

## Decisions

Synchronous dispatch changes stack-wide ordering and requires an ADR before `ready`.
