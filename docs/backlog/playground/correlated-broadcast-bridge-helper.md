---
area: playground
status: draft
title: Consolidate correlated cross-realm request/reply engines
created: 2026-06-30
why: nine live cross-realm clients own closely related request id + pending Map + deadline + teardown correlation engines, so lifecycle fixes and audits repeat across packages
user_story: As a rifty maintainer touching a cross-realm bridge, I want one tested correlation helper, but today each bridge re-implements the request/reply scaffold so a fix or audit has to be repeated per-port.
sources: [PR-167-review, docs/process/fault-classes.md]
code: [packages/workbench/src/glue/owner-vfs-client.ts, packages/workbench/src/glue/pty-client.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/internal/typescript-relay-client.ts, packages/workbench/src/workbench/internal/playground-session-tools-transport.ts, apps/playground/src/glue/owner-request-settlements.ts, packages/net/src/cross-realm/preview-port.ts, packages/runtime-js/src/host.ts, packages/npm-client/src/internal/shadow/port.ts]
---

## Context

PR #167 moved/deleted every prior `code:` anchor. Verified live mechanism sweep:

- `owner-vfs-client.ts` — pending-commit + host-ack settlement maps (PR #175
  melted the receipt/cleanup twins; two maps remain);
- `pty-client.ts:192-200` — session/run/resize/config maps + operation sequence;
- `workbench-browser-owner.ts:270-271` — owner-operation map + deadline map;
- `typescript-relay-client.ts:327` — TS relay waiters;
- `playground-session-tools-transport.ts:838` — session-tools waiters;
- `owner-request-settlements.ts:94` — read/mutation settlements;
- `cross-realm/preview-port.ts:684` — BroadcastChannel preview waiters/streams;
- `runtime-js/src/host.ts:111-112` — Worker eval and FS waiters;
- `npm-client/src/internal/shadow/port.ts:251-343` — shadow-asset read
  correlation (ninth engine, PR #175; ADR-0321 records why it stays
  package-local and names this item the consolidation owner).

Classify: design debt, not a confirmed behavior bug. These engines are related,
not behaviorally identical: mutation admission, stream progress, retained
terminals, and teardown outcomes differ. `fault-classes.md` §Class-kill requires
consolidation under one owner or an ADR for genuinely separate instances.

Boundary gate: dedicated Worker/MessagePort paths cannot duplicate, reorder, or
lose-then-replay frames while alive; BroadcastChannel may miss an unattached
receiver but does not duplicate or reorder within a sender pair. Consolidation
must preserve each real death/attachment outcome and must not add replay ledgers
for physically excluded faults. Product reachability exists through Workbench
open/PTY/session tools/TS, preview dispatch, and `spawnRuntime`.

## Options or Next

- Refine the shared invariant first: correlate, settle once, cancel deadline,
  reject/resolve on certified teardown. Keep protocol-specific admission and
  streaming outside it.
- Choose one layer-correct package-internal owner with a shared consumer suite.
- Migrate behind existing wire shapes and differential lifecycle tests.

## Out of scope

- Changing wire frames or observable lifecycle behavior.
