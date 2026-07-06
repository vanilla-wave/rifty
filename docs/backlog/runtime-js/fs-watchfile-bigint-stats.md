---
area: runtime-js
status: draft
title: fs BigIntStats parity (stat family + watchFile)
created: 2026-07-06
why: Node accepts `{ bigint: true }` on statSync/lstatSync/fstatSync/promises.stat/lstat and `fs.watchFile`, returning BigIntStats; rifty's Stats is number-shaped only
user_story: As a package requesting BigIntStats (`typeof curr.size === 'bigint'` branches), I want bigint-shaped fields like Node; today rifty throws `NotImplementedError('fs.<surface>.bigint')` instead of returning number-shaped data that lies.
sources: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-watch.ts, packages/runtime-js/src/builtins/fs-stats.ts]
code: [packages/runtime-js/src/builtins/fs-stats.ts]
---

## Context

Every stat surface shapes its result through the one `shapeStats` boundary
(fs.ts) over the shared `Stats` class (fs-stats.ts) — `fs.watchFile` listeners
get the same class (review 2026-07-06 replaced its bespoke `StatsLike` twin).
`{ bigint: true }` fires `NotImplementedError` AT that boundary, i.e. only
after Node-visible errors: `stat(missing, { bigint: true })` stays ENOENT and
`fstat(badFd, …)` stays EBADF (probed v24; gap throws replace Node's success
path, never its error path).

Current behavior is an honest ceiling: `NotImplementedError('fs.<surface>.bigint')`
and compat ❌.

## Options / Next

Add a BigIntStats shape beside `Stats` behind the same `shapeStats` boundary,
then parity-probe Node with `{ bigint: true }` across statSync/lstatSync/
fstatSync/promises and watchFile (existing + missing-at-start targets). Keep
the default number-shaped path unchanged.

## Reversibility

REVERSIBLE — accepting an option that currently throws is additive.
