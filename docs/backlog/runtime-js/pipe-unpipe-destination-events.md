---
area: runtime-js
status: draft
title: `Readable.pipe`/`unpipe` emit `'pipe'`/`'unpipe'` on the destination
created: 2026-09-23
why: Node emits `dest.emit('pipe', src)` on `pipe()` and `'unpipe'` on `unpipe()`; rifty emits neither, so code tracking its sources by these events sees nothing
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-final-green.json, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

REV-12 discovery (Final+GREEN concern, Scope) of
`runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`; pre-existing, not on
vitest's path. Probe (evidence §Sibling gaps): Writable `'pipe'`/`'unpipe'`
listeners across `pipe()` + `unpipe()` → rifty `""`, Node v24.16.0
`pipe,unpipe`; P3 (`pipe(process.stdout, {end: true})`, unpipe at source
end) → Node `events=pipe:true unpipe:true`. Compat: `streams.md`
`Readable.pipe` ⚠️ row names the gap.

## Next

Owner runtime-js; trigger: a claimed package listening for `'pipe'`/`'unpipe'`
or the next `Readable.pipe` unit. Parity first: event order and `src` argument
on `pipe()`, explicit `unpipe()`, unpipe at source end, and `{end: false}`.
