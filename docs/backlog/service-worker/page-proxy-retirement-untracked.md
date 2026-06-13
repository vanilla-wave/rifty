---
area: service-worker
status: blocked
title: ADR-0123 page-proxy retirement follow-up is untracked (dual bridge path lingers indefinitely)
created: 2026-06-13
why: ADR-0123 deliberately keeps two preview bridge paths (page window proxy + direct SW→Worker) coexisting with a retirement follow-up gated on deployed old-SW/new-page skew elapsing; nothing tracks that gate, so the legacy page proxy lingers as maintenance surface and a second readiness/auth path.
sources: [ADR-0123, ADR-0040]
code: [apps/playground/src/glue/preview-bridge-wiring.ts, apps/playground/src/glue/realVite.ts, packages/service-worker/src/owner-resolver.ts]
---

## Context

ADR-0123 Consequences: 'two bridge paths coexist until the page proxy is retired' and 'retire the page proxy only after deployed old-SW/new-page skew is no longer a concern.' The dual path is live: preview-bridge-wiring.ts mounts the page-side handler with a window-bridge dispatchToPort else-branch; realVite.ts:147 calls mountPlaygroundPreviewBridge; owner-resolver.ts keeps FirstWindowOwnerResolver as the documented window fallback. No backlog item and no code TODO gate the retirement. Compounds the separately-tracked window-owner-auth gap (preview-owner-window-auth.md) since the page proxy is the second readiness/auth path.

## Options or Next

Record the gate: after the deployed old-SW/new-page skew window elapses (define the SW_ROUTING_VERSION skew horizon), remove the page-side window proxy + FirstWindowOwnerResolver fallback so Worker-owned routing is the sole path. Pre-conditions: confirm no page-owned Dev Mode consumer needs the window bridge; bump SW_ROUTING_VERSION if removal narrows accepted owner shapes. Until then attach // TODO(backlog: service-worker/page-proxy-retirement-untracked) at the fallback sites.

## Reversibility

REVERSIBLE — backlog item records the gate; removal of a skew fallback. If removal narrows accepted owner shapes on the wire it requires a SW_ROUTING_VERSION bump and may need a decision subagent to extend ADR-0123/0040.
