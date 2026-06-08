---
area: perf
subsystem: net
status: active
title: ADR-0091 — optional dispatchStruct({url,method,headers,body}) fast-path on CrossRealmPortHandler
created: 2026-06-08
why: per-request body copied 5-6x across realms (no Transferables); skip one O(N) copy + arrayBuffer() drain + Request rebuild; write-before-code
sources: [perf-audit #21, adr-plan A/ADR-0091, ADR-0043/0048 (not contradicted)]
---
## Context
route-preview.ts:81; preview-bridge-wiring.ts:41-43; preview-port.ts:171-176,431,449. Governs exported CrossRealmPortHandler (net/src/index.ts), consumed by apps/playground preview wiring. rule1 (additive method on cross-package-exported interface — "touches", not "breaks"). Drop the BroadcastChannel transfer claim (postMessage takes no transfer list); copies 4-5 gated on M12 MessagePort swap.
## Options / Next
Optional `dispatchStruct({url,method,headers,body})` skips page→worker `new Request(...)` + `arrayBuffer()` drain + Request rebuild, used by real-vite wiring. Feasibility gap ADR must record: page reaches handler only via dispatchToPort(port, Request) and holds no CrossRealmPortHandler ref / getHandler returns base PortHandler — ADR records the extra plumbing (typed handler handle); audit rejects threading the record through dispatchToPort. Preserve identical handler bytes (e2e m7/m10); don't re-diverge devMode + realVite shared wiring.
## Reversibility
IRREVERSIBLE — rule1 (additive method on exported interface). Does NOT contradict ADR-0043 (BroadcastChannel carrier) / ADR-0048 (frame shape). No decision subagent.
