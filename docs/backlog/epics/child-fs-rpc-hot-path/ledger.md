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
- 2026-08-26 — perf/child-fs-perf-artifact-core Contract+RED attempt 3
  (split-unit attempt 1) BLOCKER @ 878e87a95: five porous verifier/CLI/atomic
  replacement mutants — RED re-cut in place
- 2026-08-26 — perf/child-fs-perf-artifact-core verify BLOCKER @ f675ff5d9:
  real Vite oracle + five remaining deep/port mutants — RED re-cut in place
- 2026-08-26 — host Vite 7.3.6 canonical-tree probe = 2195 modules/908 ms;
  goal's 2180 count belongs to the physical Rifty lane contracts, not raw parser
- 2026-08-26 — perf/child-fs-perf-artifact-core verify 2 BLOCKER @ 0c0515cad:
  alternate-positive, negative numeric and N+1 RED rows missing — extended
- 2026-08-26 — perf/child-fs-perf-artifact-core final verify BLOCKER @
  e14c22b72: 3-decimal timing-rounding mutant survived — precision RED added
- 2026-08-26 — perf/child-fs-perf-artifact-core pass verify BLOCKER @
  c1769da54: build-side `speedupX` extra-key mutant survived — symmetric RED
