---
area: runtime-wasi
status: draft
title: WASI runner first-call missing _start/_initialize throws plain Error, not Node's ERR_INVALID_ARG_TYPE
created: 2026-06-21
why: On the FIRST `start()`/`initialize()` call, rifty's lenient runner throws a plain `Error('WASI module has no _start export')` / `Error('WASI.initialize requires a module without _start export')` with no `.code`; real Node v24 throws `ERR_INVALID_ARG_TYPE` shaped `The "instance.exports._start" property must be of type function. Received undefined`. The latch ORDER is correct (a retry throws ERR_WASI_ALREADY_STARTED, matching Node, locked by wasi.test.ts) — only the first-call error shape diverges.
user_story: As a dev whose WASI guest is a command module missing `_start`, I want `wasi.start(instance)` to throw Node's `ERR_INVALID_ARG_TYPE` with the `instance.exports._start` message, but today rifty's runner throws a plain `Error` with no `.code`.
sources: [packages/runtime-wasi/src/wasi.ts, packages/runtime-js/src/builtins/wasi.ts, packages/runtime-js/src/builtins/wasi.test.ts]
code: [packages/runtime-wasi/src/wasi.ts]
---

## Context

`Wasi.start()`/`Wasi.initialize()` (runtime-wasi) throw plain `Error`s for a
missing/invalid `_start`/`_initialize`. The Node-facing `WASI` wrapper (runtime-js)
already adds the `ERR_INVALID_ARG_TYPE` memory guard + the single-entry latch (order
verified vs Node 24 `finalizeBindings` — latch after memory, before `_start` check),
but it does NOT re-shape the `_start` export error. So the first-call error has the
wrong message + no `.code`; the retry is correctly `ERR_WASI_ALREADY_STARTED`.

## Options or Next

Give the Node-facing `WASI` wrapper its own `_start` validation with Node's
`ERR_INVALID_ARG_TYPE` shape (`The "instance.exports._start" property must be of
type function. Received <type>`), running AFTER the memory check and AFTER latching
`#started` (Node order) — or have the runner carry the code while staying lenient for
`runWasi`/`runWasiInWorker`. Pin with a parity case vs real Node v24.

## Reversibility

REVERSIBLE — error-shape only; no public-API/dep/ADR impact. The runner is shared by
`runWasi`/`runWasiInWorker`, so prefer adding the validation in the `node:wasi`
wrapper to avoid changing the internal runner's lenient contract.
