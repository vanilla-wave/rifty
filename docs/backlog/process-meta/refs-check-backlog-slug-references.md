---
area: process-meta
status: draft
title: refs:check does not validate backlog→backlog slug references; cutline cites a deleted backlog item and stays green
created: 2026-06-13
why: tools/refs/check.mjs validates only ADR index/citations and docs/... path citations, so backlog items that reference sibling items by bare slug (e.g. 'npm-client/prod-npm-registry-deploy-smoke') are unenforced — the consumer-ready cutline cites a backlog item ADR-0133 already deleted and CI stays green, leaving a reader chasing a 404 or re-doing closed work.
user_story: As a rifty contributor, I want `pnpm refs:check` to go red when a backlog item cites a sibling by bare `<area>/<slug>` that no longer exists, but today the checker ignores slug refs so a cutline points at a deleted item and CI stays green.
sources: [ADR-0133, docs/backlog/process-meta/consumer-ready-followup-cutline.md, tools/refs/check.mjs]
code: [tools/refs/check.mjs, docs/backlog/process-meta/consumer-ready-followup-cutline.md]
---

## Context

refs:check scope (lines 8-14) covers (1) ADR index<->disk parity, (2) ADR-NNNN citations, (3) docs/... path/glob citations. Backlog items reference sibling backlog items by bare SLUG without a docs/ prefix or .md, which refs:check ignores. consumer-ready-followup-cutline.md (2026-06-12) still lists 'npm-client/prod-npm-registry-deploy-smoke' as a pending Standable follow-up and links the file, but ADR-0133's ratification commit (7aa23c69) DELETED the `npm-client/prod-npm-registry-deploy-smoke` item (deploy smoke closed, all acceptance [x], CI smoke every deploy). So the whole backlog cross-reference graph (every open:/cutline/depends-on pointer) is unenforced except where a full docs/ path happens to appear. The cutline is one day stale and slug-rotted silently.

## Options or Next

1) Extend refs:check to resolve backlog slug references (<area>/<slug> -> docs/backlog/<area>/<slug>.md must exist), OR require cutline/index links to use full docs/ paths (which ARE checked). 2) Fix the immediate rot: remove or rewrite the cutline line to scope only the residual 'explicit deploy approval' confirm-first process gate (not technical work; arguably no backlog file needed) since ADR-0133 closed the deploy smoke. Add a regression by deleting a referenced item and asserting refs:check goes red.

## Reversibility

REVERSIBLE — backlog item; additive refs:check rule + a stale-line correction, no public API or behavior change.
