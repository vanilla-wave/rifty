---
area: runtime-js
status: draft
title: fs `ReadStream.pipe` follows `Readable.pipe` (options, process-stdio end exemption, unpipe)
created: 2026-09-23
why: fs ReadStream owns a separate `pipe` that always calls `dest.end()` and ignores options, so `fs.createReadStream(f).pipe(process.stdout)` throws `TypeError: dest.end is not a function` and `{end: false}` still ends the destination
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-final-green.json]
code: [packages/runtime-js/src/builtins/fs-streams.ts, packages/io/src/streams/readable.ts]
---

## Context

REV-12 discovery (Final+GREEN concern, Scope) of
`runtime-js/readable-pipe-never-ends-process-stdio`; pre-existing, not on
vitest's path. `fs-streams.ts:503` `pipe(dest)`: `data` → `dest.write`,
`end` → `dest.end()` unconditionally, no options, no unpipe/cleanup, no
backpressure. rifty: `fs.createReadStream('f.txt').pipe(process.stdout)` →
`TypeError: dest.end is not a function`. Node: fs ReadStream inherits
`Readable.prototype.pipe` (`pipeOpts.end !== false`, process stdio exempt,
unpipe at source end). `pipeline(fs.createReadStream(f), dst)` gets a second
chunkless `dst.end()` (no-op today, evidence §IMPLEMENT).

## Next

Owner runtime-js; trigger: a claimed program piping an fs ReadStream into
process stdio or with `{end: false}`. Parity first: `fs.createReadStream(f)`
piped to `process.stdout`, to a Writable with `{end: false}`, and listener
deltas after end, vs the `stream/pipe-*` cases.
