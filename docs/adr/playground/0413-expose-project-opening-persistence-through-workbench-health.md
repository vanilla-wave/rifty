# ADR 0413: Expose project opening persistence through Workbench health

Status: Accepted
Date: 2026-09

## Context

PR #323 selects actual first-open progress. ADR-0359 counts stop at the owner port.
Independent DEC-2 decision review: `/root/decision_323`, 2026-09-10; sources in
`docs/backlog/playground/reference/fs-dirty-stamp-findings-disposition.md`.

## Decision

- Supersede ADR-0359's owner-port-only reach; retain real operation counts,
  coalescing and unchanged stdout/stderr.
- Add optional `projectOpen: { projectId, persistence?: { persisted, total } }`
  to the existing Workbench health snapshot. No session needed; only the active
  open contributes. Persistence counts describe one drain, never whole-open percent.
- Reuse the controller's existing open `opId` across the owner health transport.
  Capture its identity when a flush starts; the browser accepts open progress
  only for that pending open. No new queue, public operation handle or coordinator.
- Clear progress on open success/failure, owner death and close. `persisted === total`
  leaves the project preparing until the actual open result.
- Playground renders saving operation counts within its preparing indication.

## Alternatives

Unscoped owner counts can misattribute background drains; rejected by the selected
lifetime. A new progress service/operation API duplicates health subscriptions and
open ownership. Existing opId + health projection is sufficient.

## Consequences

Public health gains an additive field. UI reports work, not estimates or speedup.
