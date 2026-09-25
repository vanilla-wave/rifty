---
area: runtime-js
status: draft
title: "`Readable.pipe` from a source whose `'end'` already fired ends the destination on `nextTick`"
created: 2026-09-24
why: Node's `pipe()` sees `endEmitted` and schedules the end step on `nextTick`; rifty waits for an `'end'` that never comes, so the destination never ends or unpipes
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`
(vitest-run-in-browser item 6; unit Out of scope "pre-existing,
unchanged"; evidence §Node mechanism `internal/streams/readable` :932-935
— `kEndEmitted` → `process.nextTick(endFn)`, else `src.once('end',
endFn)`); not tracked before this draft.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`): inside the
source's `'end'` listener, `src.pipe(w)` into a fresh Writable, 20 ms later
print `w.writableEnded` and `src.listenerCount('end')`:

```
node v24.16.0: dest finished | dest writableEnded true  src listeners end 1
rifty:                         dest writableEnded false src listeners end 2
```

## Next

Owner runtime-js (io streams). Trigger: a consumer piping a possibly
ended source (late `pipe()` after `'end'`), or the next `Readable.pipe`
unit (`runtime-js/pipe-unpipe-destination-events` touches the same
method). Parity first: the probe above, with `{end: false}` and with a
`process.stdout|stderr` destination (unpipe only).
