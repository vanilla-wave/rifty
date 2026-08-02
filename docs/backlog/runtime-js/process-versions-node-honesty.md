---
area: runtime-js
status: draft
title: Reconcile process.versions.node='24.0.0' impersonation with ADR-0026 honesty
created: 2026-06-08
why: platform/arch are honest ('rifty'/'wasm') but version/versions.node lie; the inconsistency has no ADR carve-out
user_story: As a developer running a package that gates Node code paths on `process.versions.node`, I want that gate to stay enabled, but the honesty principle means it could be dropped to `versions.rifty`-only — then the package silently takes its "no Node" branch
sources: [ADR-0026, ADR-0164, ADR-0345, audit P1-4, npm-client/reference/sass-1.100-node-selector-probe]
code: [packages/runtime-js/src/builtins/process-identity.ts:11]
---
## Context
`RiftyProcess` reports honest `platform='rifty'`/`arch='wasm'` (ADR-0026) but `version='v24.0.0'` + `versions={node:'24.0.0',v8:'13.6.0',rifty:'0.0.0'}` (tracks the Node 24 target). Exact `sass@1.100.0` is concrete load-bearing evidence: its preamble selects the Node path by the own-key presence of `process.versions.node`, before its separate `process.release.name` path-API gate (ADR-0345). Dropping the key makes Sass take its browser path. The wider impersonation choice still has no ADR-0026 carve-out. `TODO(backlog: runtime-js/process-versions-node-honesty)` remains beside the identity constant.
## Options / Next
Chosen (provisional): A — keep impersonation; write an ADR-0026 amendment carving out `versions.node` rather than silent code drift. Alts: B honest-everywhere (`versions.rifty` only, drop `versions.node`) — doubles per-pkg shim cost beyond the ~10-pkg budget, pkgs silently take "no Node" branch; C keep + warn on direct `process.version` read — noisy, cries wolf. Promote A via ADR amendment to clear the marker.
## Reversibility
Reversible value change (2 lines, 1 file) — but the honest carve-out belongs in an ADR amendment, so resolution needs a ratified ADR (not a code edit alone). No new dep, no cross-package API change.
