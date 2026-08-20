---
area: npm-client
status: draft
title: emnapi orphaned-reference install patch covers only @emnapi/core 1.10.0
created: 2026-08-20
why: the PR #270 install transform is exact-version-gated to 1.10.0 (the rolldown 1.0.3 pin); a lock pinning another @emnapi/core version that still carries the upstream orphaned-reference bug silently skips the patch and keeps the child-thread crash on a failed Vite build
sources: [PR #270 body — real Node 24.16.0 NAPI_RS_FORCE_WASI evidence, issue #247 item 5]
code: [packages/workbench/src/workers/emnapi-core-install-policy.ts]
---

## Context

Not a fidelity lie: an unpatched version behaves exactly like real Node under
`NAPI_RS_FORCE_WASI=1` (PR #270 evidence protocol), and upstream fixed the
cleanup in later releases (Rolldown WASI 1.1.5 is clean). But the affected
version range is unrecorded: which 1.x releases carry the bug, and whether any
other real-world lock (beyond vite8/rolldown 1.0.3) pins one, is unknown.

Intake 2026-08-20: dedup found no match. Next: bisect upstream @emnapi/core
releases for the guard's presence (exact-byte probe per version), record the
affected range here or in the compat matrix, and only then decide whether the
policy grows more pinned versions (each needs its own exact anchors + snapshot
check + runtime proof) or the range note alone closes this.
