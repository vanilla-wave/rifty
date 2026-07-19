---
kind: epic
status: ready
title: Workbench fault honesty — delayed mutations, persistence faults, and failed teardown
created: 2026-07-19
value: Under rare transport, storage, or teardown faults, Workbench never reports failed after success, healthy after lost durability, or closed while an old preview route may survive.
user_story: As a developer whose browser owner, storage, or service worker fails at the worst moment, I want Workbench to expose the exact bounded outcome and prevent unsafe continuation, but today delayed terminals, flush failures, and lost teardown handles can leave the UI disagreeing with the owner.
items: [playground/owner-vfs-mutation-terminal-certainty, playground/session-tool-mutation-terminal-certainty, playground/preview-route-teardown-certainty, playground/workbench-persistence-health-propagation]
---

## Outcome

Every admitted mutation has one owner-proved terminal even when its response crosses a page deadline or is lost. Session-tool persistence failures degrade current Workbench health until recovery is proved. Preview teardown retains exact route authority across failure while existing lifecycle poisoning blocks the next project from opening over uncertain state.

Project switching keeps its accepted semantics: the full active `ProjectSession` — runtime, PTY, session tools, and preview routes — closes before the next session opens. A physical Workbench owner may be reused, but no live root is repointed and no second project becomes active during teardown. Failure stops the switch; it never keeps both environments live.

## User scenario

A developer opens the real Vite Starter, saves a file, then stages and commits it through Workbench while the owner is stalled. The conditional file receipt and Git response cross their transport deadlines, and the first terminal frames are lost. The UI does not turn either admitted operation into a false definitive failure or execute a retry twice; it converges to the one retained owner result.

OPFS then fails a session-tool flush after an in-memory Git mutation. The operation reports the exact error and Workbench health becomes degraded until a later durability barrier proves recovery. Finally, the developer switches to the real Express Starter while service-worker preview teardown throws. The failure stays visible, repeated close returns the same failure, the route handle is not forgotten, and Express remains blocked instead of opening over a possibly live Vite route.

## Items

- `playground/owner-vfs-mutation-terminal-certainty` (draft) — preserve one conditional VFS terminal across response timeout, loss, replay, and close.
- `playground/session-tool-mutation-terminal-certainty` (draft) — retain and replay one SCM/archive mutation result without duplicate execution.
- `playground/preview-route-teardown-certainty` (draft) — retain the mounted route handle across failed teardown while lifecycle poisoning blocks the next session.
- `playground/workbench-persistence-health-propagation` (draft) — project session-tool SCM/archive persistence failures into current Workbench health.

## Scope boundaries

- `workbench-stabilization` owns the ordinary editor and startup-diagnostic flow; no timeout, quota, or teardown fault is needed to reproduce its items.
- `fault-honest-opfs-persistence` owns lower storage, crash/reload, and persisted-artifact truth. This epic owns the live Workbench health projected from that truth.
- `fault-honest-sw-preview` owns HTTP/WS broker settlement. This epic owns the page registry's possession and retirement of mounted route handles.
- These four children are prerequisites to `distribution/workbench-controllers` package seal; this epic repairs private lifecycle correctness and adds no public surface.
- Vite and Express are acceptance consumers only. Generic transport, storage, and teardown behavior does not branch on either tool.

The same audit confirmed separate platform gaps in `runtime-js/esm-module-job-graph-parity`, `runtime-js/require-extensions-extensionless-resolution`, and `kernel/sync-rpc-primordial-integrity`; they are outside both Workbench epics. PTY mutation/control ACK correlation, VFS close draining, ProjectSession/owner lifecycle teardown poisoning, and same-path editor write serialization are already present on current `main`; no duplicate children are created.
