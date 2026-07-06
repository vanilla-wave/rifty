---
area: runtime-js
status: draft
title: fs.watchFile bigint Stats parity
created: 2026-07-06
why: Node accepts `fs.watchFile(path, { bigint: true }, listener)` and passes BigIntStats, while rifty's watcher currently has only number-shaped StatsLike
user_story: As a package requesting BigIntStats from `fs.watchFile`, I want `curr.size`/`mtimeMs`-style fields to be bigint like Node, but today rifty throws `NotImplementedError('fs.watchFile.bigint')` instead of returning number-shaped data that lies.
sources: [packages/runtime-js/src/builtins/fs-watch.ts]
code: [packages/runtime-js/src/builtins/fs-watch.ts]
---

## Context

`fs.watchFile` is implemented over polling snapshots with number fields. Node's
`{ bigint: true }` option changes the listener payload to BigIntStats. Returning
the current number-shaped `StatsLike` under that option would silently break
callers that branch on `typeof curr.size === 'bigint'`.

Current behavior is an honest ceiling: `NotImplementedError('fs.watchFile.bigint')`
and compat ❌.

## Options / Next

Add a BigIntStats-shaped payload for watchFile snapshots, then parity-probe Node
with `{ bigint: true }` over both existing and missing-at-start targets. Keep the
default number-shaped watcher path unchanged.

## Reversibility

REVERSIBLE — accepting an option that currently throws is additive.
