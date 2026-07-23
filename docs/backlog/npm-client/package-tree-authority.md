---
area: npm-client
status: draft
title: One package-tree authority — FIFO + claim commit protocol behind the frozen boundary
created: 2026-07-23
why: split epoch/readiness/admission ownership produced the #160 nested-cwd blocker; ADR-0309 consolidates the installed-tree lifecycle into one owner, and with ADR-0307 in force it consolidates far less (no tree-epoch surveillance)
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-registry-core]
sources: [ADR-0307, ADR-0309, PR-160]
---

## Context

Slice `package-tree-authority` (see epic §Budget). One owner for package FIFO,
ADR-0261/0307 claim commit protocol, readiness publication, and child
reservation (readiness → synchronous spawn → supervision; no timeout-released
reservations). Replaces implementations BEHIND the registry-core slice's
frozen boundary contract, keeping its tests green unedited.

Contract+RED must use the PRODUCTION owner composition and cover: `cd sub &&
npm install` with exact Node package-tree ancestry; trusted/snapshot/
fresh-install/post-tree-failure paths; mutation during readiness; close during
install; reservation commit/abort; confirmed child termination; the
bare-authority vs production-owner sibling sweep (the quarry blocker's class),
including torn readiness publication. Whether facts are per install root or
composed by ancestry is decided by this contract, not assumed.

The reliability deletion/collapse pass rides here (plan Phase 3): delete
read-deadline ladders, replay/duplicate ledgers, double SHA framing,
post-ensure rereads, split-ownership compensators once the Contract+RED proves
them unreachable; keep every real-boundary check (network SRI/caps, strict
codecs, OPFS receipt chain + read-back SHA of actual stored bytes, port-client
deadline + downward cancel, origin-wide Web Lock, FIFO reservation).

Refine before pickup (`rifty-refine`).
