---
area: runtime-js
status: active
title: Reconcile process.versions.node='22.0.0' impersonation with ADR-0026 honesty
created: 2026-06-08
why: platform/arch are honest ('rifty'/'wasm') but version/versions.node lie; the inconsistency has no ADR carve-out
sources: [ADR-0026, audit P1-4]
code: [packages/runtime-js/src/builtins/process.ts:82]
---
## Context
`RiftyProcess` reports honest `platform='rifty'`/`arch='wasm'` (ADR-0026) but `version='v22.0.0'` + `versions={node:'22.0.0',v8:'12.0.0',rifty:'0.0.0'}`. Many ecosystem pkgs branch on `process.versions.node` to enable Node code paths, so the lie is plausibly load-bearing — but it contradicts ADR-0026's honesty principle with no recorded carve-out. TODO(backlog: runtime-js/process-versions-node-honesty) marker on file at process.ts:82 (`version`/`versions` at :85-86).
## Options / Next
Chosen (provisional): A — keep impersonation; write an ADR-0026 amendment carving out `versions.node` rather than silent code drift. Alts: B honest-everywhere (`versions.rifty` only, drop `versions.node`) — doubles per-pkg shim cost beyond the ~10-pkg budget, pkgs silently take "no Node" branch; C keep + warn on direct `process.version` read — noisy, cries wolf. Promote A via ADR amendment to clear the marker.
## Reversibility
Reversible value change (2 lines, 1 file) — but the honest carve-out belongs in an ADR amendment, so resolution needs a ratified ADR (not a code edit alone). No new dep, no cross-package API change.
