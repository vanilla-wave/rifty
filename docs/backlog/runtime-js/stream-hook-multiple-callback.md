---
area: runtime-js
status: draft
title: A stream hook calling its callback twice raises no ERR_MULTIPLE_CALLBACK
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
| Transform `_final` wrapper calling back twice | `…,error ERR_MULTIPLE_CALLBACK`, `_flush` ×2 | no error, `_flush` ×3 |

Present before PR #433 (Writable `done`/`finalize` closures have no called-once guard); PR #433
made subclass hooks reach the same path. Code: `drainBuffer`'s `done` and `doFinal`'s `finalize`
in `writable.ts` accept every call.

Owner: runtime-js (`@riftydev/io` Writable). Trigger: a package with a buggy hook relying on
Node's error, or a double callback hiding behind repeated `'prefinish'`. Compat streams.md
`Transform` ⚠️.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
