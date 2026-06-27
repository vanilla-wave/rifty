---
area: playground
status: draft
title: Rename RIFTY_RFV_* env prefix → RIFTY_RT_* + Mode token 'real-vite' → 'project'
created: 2026-06-08
why: ADR-0078 made the real-vite worker template-agnostic but left two Vite-branded names; generic surface still carries "RFV" / "real-vite"
user_story: As a developer using the rifty web playground, I want a generic project runner whose env keys and mode token aren't Vite-branded, but today the template-agnostic surface still reads `RIFTY_RFV_PORT/ROOT/ENTRY` and `Mode 'real-vite'`, falsely implying Vite-only and confusing non-Vite project setups.
sources: [ADR-0078, ADR-0076, ADR-0043, ADR-0080]
---
## Context
ADR-0078 kept blast radius small: `RIFTY_RFV_*` prefix (`PORT/ROOT/ENTRY/TEMPLATE`) now names a generic surface + keys snapshot/write/HMR/node_modules BroadcastChannels via `channelNameFor`. Internal `Mode` token `'real-vite'` read at ~24 sites incl. ADR-0076 snapshot gate + e2e `[data-preset]` contract. No code marker; captured here + ADR-0078.
## Options / Next
Provisional: defer both. Re-keying channels / mode token now touches 4 bridges + ~24 read-sites for zero functional gain, risks desyncing `RIFTY_RFV_PORT`-keyed channels mid-change. Generic UI naming already via `ProjectSpec.displayName`. Next: mechanical sweep `RIFTY_RFV_*`→`RIFTY_RT_*` (+ optionally `Mode 'real-vite'`→`'project'`) once switcher/channel contracts settle — single PR, no behavioural change. Coordinate with m10 e2e worker-log markers so prefix + asserted strings move together.
## Reversibility
Reversible — single-PR mechanical rename, no behavioural change. Gate: do after switcher/channel contracts settle; coordinate with e2e asserted strings.
