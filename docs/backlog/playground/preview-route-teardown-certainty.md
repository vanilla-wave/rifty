---
area: playground
status: draft
title: Preview registry retains route authority until teardown is certain
created: 2026-07-19
why: the registry deletes a mounted route handle before calling teardown, so a thrown service-worker cleanup loses the only exact teardown authority while the stale route may remain live
user_story: As a developer switching or closing a project, I want every old preview route gone before the next environment opens, but today the UI can forget a route that the service worker still serves.
epic: workbench-stabilization
blocked_by: []
sources: [PR-153-post-merge-audit, ADR-0271, ADR-0278, fault-classes]
code: [apps/playground/src/workbench/internal/playground-preview-registry.ts, apps/playground/src/glue/preview-port-wiring.ts, apps/playground/src/glue/preview-bridge-wiring.ts]
---

## Context

`tearDownPorts()` removes a port from `mounted` before invoking its route handle's `tearDown()`. If GOODBYE, unregister, or another teardown step throws, the registry reports an error but no longer holds the exact handle needed to finish cleanup or prove why admission must stay fenced. The public snapshot can be empty while the stale service-worker route remains reachable; a later session reusing the port can receive stale-project bytes or a false 503. This is `torn-state`, `provenance-lie`, and `observable-order` at the route-ownership boundary.

## Refinement path

- Preserve ADR-0271: repeated close returns one promise. Define route lifecycle states and the one authority that may forget a mounted handle; failed teardown stays visible, retains enough internal authority to prevent ambiguity, and blocks the next project/route admission.
- RED first for failure before GOODBYE, between broker withdrawal and unregister/revoke, repeated teardown, close during reconciliation, and same-port admission after failure. Prove the old route cannot serve once new project open begins.
- Sweep all `tearDownPorts()` callers: withdrawn ports, reconciliation replacement, operational failure, and registry/session close. Pin aggregate-error ordering without losing surviving handles.
- Keep in-flight HTTP/WS settlement in `fault-honest-sw-preview`; this item owns possession and retirement of the mounted page-to-SW route.
- Do not invent a public retry surface in this fix. Any retryable close contract must supersede ADR-0271; otherwise recovery closes/recreates the failed Workbench before another project opens.
