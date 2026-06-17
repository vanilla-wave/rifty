---
area: runtime-js
status: parked
title: Wire remote-FS into the generic worker-backed child_process.spawn so a node child sees the parent/owner filesystem
created: 2026-06-17
why: the generic worker path (spawnViaWorker → former spawnWorkerChild) never set RIFTY_REMOTE_FS, so a spawned worker read its OWN empty mirror instead of the parent/owner store — a Node-parity break (a node child must see the parent fs). Reachable only from a realm that serves nothing to the child (owner/page); the supervised-child realm keeps the same-realm fallback. Closed as a LOUD throw (review #1, ADR-0150) — this item is the proper fix that re-enables the worker path
user_story: As a dev whose program does child_process.spawn('node', ['child.js']) / fork() from a realm with the kernel + node-entry worker URLs, I want the worker child to read the same filesystem as its parent (the owner store over fs.* sync-RPC), not throw NotImplementedError
sources: [ADR-0150, ADR-0011, ADR-0137]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/owner-child-bin-executor.ts]
---

## Context

Re-derived at HEAD (review #1). The generic worker route in `spawn()` now THROWS
`NotImplementedError('child_process.spawn[worker]')` instead of silently spawning an
empty-mirror child. The `.bin` path already works because `owner-child-bin-executor.ts`
sets `RIFTY_REMOTE_FS=1`, so the child's `node-entry-bootstrap` installs the owner store as
its global sync mirror. The generic path has no equivalent wiring.

The subtlety that makes this non-trivial: setting `RIFTY_REMOTE_FS=1` only works if the
SPAWNING realm SERVES the child's `fs.*` calls. Only the owner registers `fs.*` handlers
(ADR-0150); the page does not. So this needs either (a) the spawner to route the child's
`fs.*` through the owner's fs-server, or (b) a per-realm "do I serve fs.*?" capability the
generic path can check before opting the child into remote-FS vs. throwing.

## Options or Next

- Owner realm: set `RIFTY_REMOTE_FS=1` in the generic spawn spec (the owner already serves
  `fs.*`) — the worker child reads the owner store, Node-parity restored.
- Page realm (does not serve `fs.*`): keep the loud throw, or proxy `fs.*` to the owner.
- Likely needs a small ADR (changes generic-spawn FS semantics + the realm capability check)
  and re-introduces a worker-spawn module (the deleted `child_process-worker.ts`).

## Reversibility

IRREVERSIBLE-ish — re-introduces worker-spawn + changes generic-spawn FS semantics → own ADR
when built. Recorded here until then.
