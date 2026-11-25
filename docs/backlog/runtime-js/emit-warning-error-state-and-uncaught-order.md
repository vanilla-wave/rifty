---
area: runtime-js
status: draft
title: "`process.emitWarning` treats `Error.stackTraceLimit` and a same-tick uncaught exception as Node does"
created: 2026-11-24
why: rifty's `emitWarning` differs from Node v24.16.0 in three observed cases — the `stackTraceLimit` it leaves, a throwing limit getter, and a `'warning'` listener running before a same-tick uncaught exception ends the process
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md]
code: [packages/runtime-js/src/builtins/process-warnings.ts]
---

## Context

Found by the PR #444 review, round 2 (Node side), rifty side measured 2026-11-24 in the isolate
guest (`runCode` vs `node -e`, Node v24.16.0; browser hosts not measured):

| `-e` code | Node stdout, exit | isolate stdout, exit |
|---|---|---|
| `delete Error.stackTraceLimit; process.emitWarning('w'); console.log(Object.hasOwn(Error, 'stackTraceLimit'), Error.stackTraceLimit)` | `true undefined`, 0 | `false undefined`, 0 |
| a throwing `get` for `Error.stackTraceLimit`, then `try { process.emitWarning('w') } catch (e) { … }` | `threw limit getter`, 0 | `no throw`, 0 |
| `process.on('warning', () => console.log('listener')); process.emitWarning('w'); throw new Error('boom')` | (nothing), 1 | `listener`, 1 |

Node's `emitWarning` creates the warning `Error` with its own `stackTraceLimit` handling and
delivers the event on `process.nextTick`, which a fatal exception in the same tick never reaches.
No compat row yet.

## Next

Owner runtime-js (`process-warnings.ts`). Trigger: a program depending on any of the three. First
step: Node's `lib/internal/process/warning.js` (`createWarningObject`, `emitWarning`) vs rifty's.
