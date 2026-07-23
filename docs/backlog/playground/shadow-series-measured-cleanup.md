---
area: playground
status: draft
title: Measured cleanup after the shadow series — reachability-gated deletions and arch ratchets
created: 2026-07-23
why: the series leaves independently deletable leftovers that must be removed through measurement/reachability gates, not narration — dead code has to be proven unreachable before deletion, and blanket check exemptions must narrow to exact modules
epic: honest-shadow-substitutions
sources: [ADR-0308, PR-160]
---

## Context

Slice `measured-cleanup` (see epic §Budget). Candidates, each behind its own
gate:

- dead worker-multiplexing code (the quarry carried ~900 LOC of CDP worker
  multiplexing + tests; on current main the grep is clean — delete only what
  the extraction actually imports, after a production reachability/deletion
  check);
- replace the blanket `tools/` architecture-tier exemption with the exact
  generated/tool modules required;
- owner READMEs for source dirs crossing the 30-file bar after the series
  (`packages/workbench/src/workers`, `src/glue`, `packages/npm-client/src`);
  file count triggers a README, not an automatic split;
- remaining follow-ups resolved through reachability and tier gates; no source
  work hidden in new drafts.

Refine before pickup (`rifty-refine`).
