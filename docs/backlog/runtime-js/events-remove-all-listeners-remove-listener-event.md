---
area: runtime-js
status: draft
title: "`EventEmitter#removeAllListeners` emits `'removeListener'` per dropped listener, as in Node"
created: 2026-09-25
why: Node's `removeAllListeners` emits `'removeListener'` for each removed listener (LIFO; no argument: own-key order, `'removeListener'` last); `@riftydev/io` (rifty's `node:events`) clears silently, so code that tracks listeners through `'removeListener'` never sees the removal
sources: [docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md, docs/backlog/runtime-js/worker-threads-handle-keepalive.md, docs/adr/runtime-js/0446-count-live-worker-threads-workers-in-child-realm-keepalive.md]
code: [packages/io/src/event-emitter.ts, packages/runtime-js/src/builtins/fs-watch.ts, packages/kernel/src/process-manager.ts]
---

## Context

REV-12 discovery of `runtime-js/worker-threads-handle-keepalive`
(vitest-run-in-browser item 8; Decisions "required repairs"). That unit
applies Node's effect on `kPublicPort` inside `Worker#removeAllListeners`
(ADR-0446 §1) instead of changing the shared emitter.

Node v24.16.0 (evidence §IMPLEMENT, `ee-remove-all.cjs`, plain emitter):
`rm:x:bound onceWrapper:2 / rm:x:b:1 / rm:x:a:0 / after-x:0,1,1 / rm:y:a:0 /
rm:x:a:0 / after-all:0`.

Rifty: `event-emitter.ts:109` `removeAllListeners` deletes the map entry (or
clears the map) and emits nothing. `node:events` re-exports this emitter
(`builtins/events.ts:7`).

Blocker for a plain fix (tried in that unit): emitting turned
`no-coi-project-watches.test.ts` "silently retires FSWatcher abort and event
callbacks" red — ADR-0422 retirement (`fs-watch.ts:117`) and kernel teardown
(`process-manager.ts` `removeAllListeners()` calls) rely on the silent
clear. A fix separates those internal silent clears from the public method.

## Next

Owner runtime-js (`node:events` via `@riftydev/io`). Trigger: a claimed
consumer tracking listeners through `'removeListener'`. Parity first:
`ee-remove-all.cjs` as a `node:events` case; the FSWatcher retirement test
stays green.
