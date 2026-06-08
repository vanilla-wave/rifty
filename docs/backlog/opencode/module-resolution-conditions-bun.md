---
area: opencode
status: active
title: ADR-0054 draft — per-load module resolution conditions (opt-in 'bun')
created: 2026-06-08
why: undecided draft — overlay (C) vs a programmatic conditions field (A); not ratified
sources: [docs/backlog/opencode/reference/decisions.md ADR-0054 draft, ADR-0004, Q-2026-05-30-103, audit-digest]
---
## Context
opencode's `#db`/`#pty` `imports` maps carry a `bun` branch; rifty's `CONDITIONS = ['node','default','import','require']` has no `bun`, so `#db` lands on the `node` branch (`node:sqlite`). De-risk: both branches hit an unregistered builtin regardless, so adding `bun` alone unblocks nothing — it only chooses WHICH specifier the SQLite shim intercepts. Note: NOT the on-disk ratified ADR-0054 (that one is `effect-consumes-node:http`); this is the decisions.md DRAFT numbering for the conditions decision.
## Options / Next
(A) add optional `ModuleLoaderOptions.conditions?: readonly string[]` + `createResolver(vfs,{conditions})`; opencode loads `['bun','node','import','default']` — minimal API growth, DEVIATES from ADR-0004 (Node has no `bun`). (B) richer `importsOverride` table — larger/opinionated, defer. (C, RECOMMENDED) zero-API-change shadow-registry `package.json` overlay — hardcode `#db`→shim path via VFS overlay, leaves resolver + ADR-0004 untouched, REVERSIBLE; brittle across opencode versions but downgrades the whole decision to reversible. Recommendation: PREFER (C) unless a later feature truly needs programmatic (non-overlay) condition control — overlay + throw-stub (Q-2026-05-30-102) suffice for P0/P2 with no API change. If (A) chosen, the ADR must frame opt-in `bun` as a deliberate ADR-0004 deviation.
## Reversibility
IRREVERSIBLE if (A) (permanent runtime-js public surface, deviates from ADR-0004); REVERSIBLE if (C) (overlay only, no API change). Draft, not ratified — decide between A and C before coding the delivery vehicle. Q-2026-05-30-103 (bun condition order) reversible, contingent on scoped delivery.
