---
area: playground
status: draft
title: A failed preview route teardown leaves no stale route reachable by the next project
created: 2026-10-25
why: the preview registry forgets a mounted route before its teardown runs, and a throw in the first teardown hop skips the rest, so a failed teardown can leave the page port registration and bridge of a retired project behind with no handle to finish them
sources: [ADR-0271, ADR-0278, PR-158-salvage-2026-10-25]
code: [packages/workbench/src/workbench/internal/playground-preview-registry.ts, packages/workbench/src/workbench/workbench-browser-owner.test.ts, packages/workbench/src/glue/preview-port-wiring.ts, packages/service-worker/src/preview-bridge.ts, packages/net/src/registry.ts]
---

## Context

Salvaged from PR #158 (2026-07-19 audit draft, then under
`apps/playground/src/workbench`); re-read on main `7d038adb0`, code-read only,
no repro.

- `tearDownPorts` deletes `mounted` before `route.tearDown()`
  (`playground-preview-registry.ts:156-168`); callers: invariant failure
  `:238`, degrade `:260`, reconcile withdrawal `:302`, close `:490`.
  Degrade keeps the registry `live`, so a later reconcile may re-mount the
  same port.
- Route teardown order `tearSwBridge` → `unregisterPort` → `dispose`
  (`preview-port-wiring.ts:24-28`); a throw in the first skips the other two,
  on every caller including close.
- The SW-facing page listener is removed in `finally` even when GOODBYE throws
  (`preview-bridge.ts:456-462`), so the retired handler cannot answer SW
  requests; what remains is the page net-registry entry and an undisposed
  bridge. `registerPort` silently overwrites a same-port entry
  (`net/src/registry.ts:38-45`).
- Close awaits SW control proof (`playground-preview-registry.ts:491-495`);
  `workbench-browser-owner.test.ts:2214` pins only a throw after GOODBYE
  was enqueued. A throw in `postHandshake` before GOODBYE is unpinned: no
  GOODBYE posted, so SW readiness may still point at a window with no
  listener; ADR-0271's guarantee holds only when close fulfills.

This item owns whether new requests can still be routed to the retired
window or port. Settlement of already-dispatched requests stays in epic
`fault-honest-sw-preview` / `service-worker/preview-dispatch-termination-chokepoint`.

## Question

After a teardown throw before or after GOODBYE (reconcile, degrade or close),
can a new request reach the retired project — via stale SW readiness, a
same-port net-registry lookup, or an undisposed bridge? If yes, what retains the
teardown handle and fences the next admission until teardown completes?
Repeated close keeps returning one promise (ADR-0271), so a fix adds no
public retry. Settled at PICKUP with RED for a throw at each hop on each
caller and same-port re-admission.
