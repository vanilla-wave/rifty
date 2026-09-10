# ADR 0415: Open saved projects independently of installation proof

Status: Accepted
Date: 2026-09

## Context

PR #323's accepted interrupted npm install scenario requires preserved files,
terminal and independent Node commands, without implicit install. Raw authority:
`docs/backlog/playground/reference/project-open-ide-boundaries-refine.md`.
Independent DEC-2 review: `/root/decision_323`, 2026-09-10.

## Decision

- Supersede ADR-0135 decision 5's forced fresh worker install and corresponding
  Consequences recovery clause only for ordinary saved opening; setup kinds and
  first materialization remain unchanged.

- Supersede ADR-0394 decision 2's rejection of saved projects on missing/pending/
  incompatible install trust; its corresponding Consequences clause follows.
- Supersede ADR-0307 request-identity-drift and ADR-0261 miss/reload/copy reinstall
  clauses only where applied to ordinary saved opening. An install-claim miss
  remains a miss; opening does not acquire or certify an installation.
- Retain the package FIFO and child reservation from ADR-0309. Read saved runtime
  facts independently of install certification; only validated shadow data may
  create bindings. An unusable lock grants no adapter capability and cannot deny
  ordinary files/Node access. Adapter failures surface when that adapter is used.
- Retain snapshot application validation, settled commit, rollback and own storage
  recovery, protected claim ingress, Save rebind and learned pins. Unreadable own
  storage still fails. ADR-0392's explicit no-COI toolchain activation remains.

## Alternatives

Removing only the open guard still blocks child admission. Reinstall/re-promotion
violates saved mutable state. A separate activation receipt duplicates lock
provenance. Reuse the existing package authority and reservation; no new receipt,
coordinator, hash cache or tree surveillance.

## Consequences

Saved-open result describes access, never a freshly proved installation. Invalid
or absent dependencies fail at use; explicit npm install remains available.
