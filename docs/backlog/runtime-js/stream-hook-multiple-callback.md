---
area: runtime-js
status: draft
title: A stream hook calling its callback twice (or calling back, then throwing) raises no ERR_MULTIPLE_CALLBACK
created: 2026-11-24
why: Node errors a stream with `ERR_MULTIPLE_CALLBACK` when `_write`/`_final`/`_transform`/`_flush` call back twice; rifty ignores the second call or replays its effect (`'prefinish'` twice, Transform `_flush` re-run) — wrong lifecycle, silently.
sources: ["PR #433 review round 1 (S2)", docs/public/compat/streams.md]
code: [packages/io/src/streams/writable.ts, packages/io/src/streams/transform.ts]
---

## Context

Found by the external review of PR #433 (stream hook dispatch), reproduced 2026-11-24, same
program in Node v24.16.0 and the rifty parity runner (branch `t3/stream-subclass-hooks`):
listeners `error`/`prefinish`/`finish`, each hook calls its callback twice.

| hook | Node | rifty |
|---|---|---|
| Writable `_write` | `error ERR_MULTIPLE_CALLBACK` | — |
| Writable `_final` | `prefinish,finish,error ERR_MULTIPLE_CALLBACK` | `prefinish,prefinish,finish` |
| Duplex `_write` | `error ERR_MULTIPLE_CALLBACK` | — |
| Transform `_transform` | `dx,dx,error ERR_MULTIPLE_CALLBACK` | `dx,dx` |
| Transform `_flush` | `prefinish,finish,error ERR_MULTIPLE_CALLBACK` | `prefinish,prefinish,finish` |
| Transform own `_final` wrapper calling back twice¹ | `…,error ERR_MULTIPLE_CALLBACK`, `_flush` ×2 | no error, `_flush` ×3 |
| `_final` calling `cb()` then throwing² | `prefinish,finish,error:late,close,endcb:late`, `writableFinished` true | `prefinish,error:late,close,endcb:late`, `writableFinished` false |

¹ `const f = t._final; t._final = function (cb) { f.call(this, cb); cb(); }`, `flush` counting, `end('x')`
(re-measured 2026-11-24 for review round 2, which reported ×3/×4 with another program; the program
here is the reference). ² `final(cb) { cb(); throw new Error('late'); }`, listeners
`prefinish`/`finish`/`close`/`error`, `end('x', endcb)` (review round 2): since PR #433 catches a
`_final` throw, the late throw re-enters `finalize` and its error wins over the pending `'finish'` —
the same missing called-once guard.

Present before PR #433 (Writable `done`/`finalize` closures have no called-once guard); PR #433
made subclass hooks reach the same path. Code: `drainBuffer`'s `done` and `doFinal`'s `finalize`
in `writable.ts` accept every call.

Owner: runtime-js (`@riftydev/io` Writable). Trigger: a package with a buggy hook relying on
Node's error, or a double callback hiding behind repeated `'prefinish'`. Compat streams.md
`Transform` ⚠️.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
