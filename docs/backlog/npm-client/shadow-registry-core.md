---
area: npm-client
status: draft
title: Shadow-substitution registry core — recipe schema, strict codec, manager/store
created: 2026-07-23
why: ADR-0308 needs its substrate — one clone-safe recipe model with OPTIONAL runtime binding, one strict ingress codec, and a manager/store whose boundary to the package-tree authority is frozen as a named contract before the authority slice replaces what sits behind it
epic: honest-shadow-substitutions
sources: [ADR-0308, ADR-0309, PR-160]
---

## Context

Slice `registry-core` (see epic §Budget). Scope per ADR-0308: recipe schema
where `{adapterId, assets}` is optional (install-only substitutions yield an
empty asset plan); one strict decode at every published/clone boundary and
invariants on frozen owner-internal values; manager/store/ready-only port
ported selectively from the quarry with the reliability machinery ADR-0309
marks for deletion left behind; per-root-export disposition (delete /
`/internal` subpath + consumer contract suite / successor ADR). The Contract
freezes the manager↔package-tree-authority boundary as a named interface with
a contract test the authority slice must keep green unedited.

Refine before pickup (`rifty-refine`): enumerate acceptance/parity from the
quarry's proven store contract, fault rows for tier `production` ×
Storage/MessagePort models (no replay/duplicate faults on live ports).
