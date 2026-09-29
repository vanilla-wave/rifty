---
area: runtime-js
status: draft
title: "`stream.pipeline` / `stream.finished` success callbacks get Node's arguments, not `null`"
created: 2026-09-24
why: Node calls a successful `pipeline` callback with `(undefined, value)` and `finished`'s with no arguments; rifty passes `null` to both, so `err === undefined` / `arguments.length` checks take the error branch
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-final-green.json, docs/public/compat/streams.md]
code: [packages/io/src/streams/pipeline.ts, tools/compat-matrix-generator/streams-inventory.js]
---

## Context

REV-12 discovery of `runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`
(vitest-run-in-browser item 6; evidence §IMPLEMENT "Base and impl both
report cb `err=null` where Node passes `undefined`"); pre-existing.
`pipeline.ts:98` and `:143` call `cb?.(null)`.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`):
`pipeline(Readable.from(['a']), <Writable>, cb)`, then
`finished(Readable.from(['b']).resume(), cb)`, each printing
`arguments.length` and argument kinds:

```
node v24.16.0: pipeline 2 ["undef","undef"] | finished 0 []
rifty:         pipeline 1 ["null"]          | finished 1 ["null"]
```

Compat: `streams.md` `pipeline`/`finished` rows ⚠️ link here (source
`tools/compat-matrix-generator/streams-inventory.js`).

## Next

Owner runtime-js (io streams). Trigger: a consumer testing
`err === undefined` or callback arity, or the next pipeline unit. Parity
first: the probe above plus the error path (one `Error` argument) and
`stream/promises` resolution values.
