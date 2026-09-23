---
area: runtime-js
status: draft
title: `process.stdout|stderr` lack Node's Writable end surface (`end`, `writableEnded`, `destroy`)
created: 2026-09-23
why: rifty's process streams are an EventEmitter with `write` only; `process.stdout.end()` and `pipeline(src, process.stdout|stderr)` throw `TypeError` where Node ends the stream (pipeline ends it once, then un-destroys it)
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-final-green.json, docs/public/compat/streams.md]
code: [packages/runtime-js/src/builtins/process-stdio-writer.ts, packages/io/src/streams/pipeline.ts]
---

## Context

REV-12 discovery (Final+GREEN concern, Scope) of
`runtime-js/readable-pipe-never-ends-process-stdio`; pre-existing, not on
vitest's path. `NodeStdioWriter` (`process-stdio-writer.ts:18`) has no `end`,
`writableEnded`, `destroy`. rifty: `typeof process.stdout.end` →
`undefined`; `process.stdout.end()` → `TypeError: process.stdout.end is not a
function`; `pipeline(Readable.from(['p\n']), process.stdout, cb)` →
`TypeError: dest.end is not a function`. Node v24.16.0 (evidence P8–P11):
`end` is a function, `writableEnded` false; pipeline calls `stdout.end()` once,
cb `err=undefined`, stdout later `ended=false`; direct `end('x\n')` then
`write` → `ERR_STREAM_WRITE_AFTER_END`. Compat: `streams.md` `Readable.pipe` ⚠️
row names the `pipeline` throw.

## Next

Owner runtime-js; trigger: a claimed program calling `process.stdout.end()` or
`pipeline(…, process.stdout|stderr)`. Parity first: P8–P11 shapes as seeded
cases (end calls, cb args, post-pipeline writability, write-after-end error).
