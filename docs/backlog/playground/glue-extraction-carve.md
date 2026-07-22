---
area: playground
status: draft
title: Carve glue subdirs along the Workbench extraction seam
created: 2026-07-22
epic: extraction-ready-page-realm
sources: [ADR-0306, ADR-0282]
code: [apps/playground/src/glue, tools/checks/arch-rules.cjs]
why: glue's 101 direct prod modules have one shared README and no structure marking what travels with @riftydev/workbench vs stays app-local
---

## Context

Behavior-preserving carve per ADR-0306: subdirs mirror the extraction boundary (extractable vs app-local, domain-grouped inside each side), disputed files resolve toward app-local. Each subdir gets its owner README (`check:dir-owner`); depcruise rules pin app-local-not-imported-by-extractable, same style as ADR-0282 sealed entrypoints. Import-path churn only; no module content changes — `pnpm check:arch` + full suite green is the whole proof. Refinement produces the file→side sort as its main artifact.
