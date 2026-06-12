---
area: service-worker
status: active
title: Window-owner readiness is unauthenticated (preview iframe can claim ready)
created: 2026-06-12
why: window binding accepts ready/ownerToken frames from ANY window client; a previewed app could self-register as bridge owner
sources: [ADR-0130 review, ADR-0046, ADR-0123]
code: [packages/service-worker/src/owner-binding-window.ts, packages/service-worker/src/owner-resolver.ts]
---

## Context

`owner-binding-window.ts` forwards `rifty:preview:ready`/`goodbye` to the registry keyed only on `ev.source.id` — no `source.type`/URL guard, no ownerToken auth (the worker binding rejects non-worker sources). A previewed app runs arbitrary same-origin JS in its iframe (a window client) and can (a) post a fake ready, (b) defeat ADR-0130's preview-document URL filter via `history.pushState` (the filter reads `client.url`, mutable while code keeps running), then win the first-window fallback for clientId-null fetches and see request frames / fabricate responses. Mitigations today: worker-owned ports stay safe (secret ownerToken gates the worker route, ADR-0123); exploit needs focus ordering + fallback-path requests. Predates ADR-0130; the new URL filter is a partial mitigation, not the fix.

## Options or Next

1. Require the page's ownerToken on window ready frames (symmetric with the worker binding) — preferred.
2. Reject window clients whose URL parses as a preview path at handshake time AND capture URL at fetch time (defeats pushState).
3. Both; bump `SW_ROUTING_VERSION`.

## Reversibility

REVERSIBLE (routing policy; recorded here + ADR-0130 follow-ups).
