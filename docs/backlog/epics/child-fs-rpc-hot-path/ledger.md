# Child fs sync-RPC hot path ledger

- 2026-08-26 — perf/child-fs-perf-lane band 8–12 expected REDs
- 2026-08-26 — perf/child-fs-perf-lane Contract+RED attempt 1 BLOCKER @
  5e025cbc8: missing committed REDs; unpinned/non-closing spike; robust CLI and
  atomic-publication fault rows absent — re-cut in place
- 2026-08-26 — perf/child-fs-perf-lane Contract+RED attempt 2 BLOCKER @
  fb02b2c2f: helper REDs cannot prove physical lanes/orchestration; second
  consecutive blocker → split in place
- 2026-08-26 — split perf/child-fs-perf-lane into artifact-core → product-lane
  + in-realm-lane → orchestrator; original remains draft lineage until absorbed
- 2026-08-26 — perf/child-fs-perf-artifact-core band 8–12 expected REDs
