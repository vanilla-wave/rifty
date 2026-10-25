# ADR-0490: Keep reference host snapshot preparation explicit

Status: Accepted
Date: 2026-10-01
Supersedes: ADR-0489 decisions 1–2 only.

## Context

User amendment to PR357: «давай явно выпилим ее из этого ПРа», referring to
identity → force → reconciliation. Existing SDK apply/open semantics suffice;
ADR-0489 decisions 3–4 (shared private host/benchmark) remain active.
Independent DEC-2 check: snapshot_scope_decision, 2026-10-01.

## Decision

- `prepare({snapshot?, files?, install?})` performs the explicitly requested
  snapshot apply with SDK default conflict behavior, then writes supplied initial
  files and optionally installs. No applied identity storage or automatic force.
- Saved reopen calls public `sandbox.toolchain.open({cwd})` through `host.call`,
  without initial snapshot/source inputs. No replacement initialized flag or
  empty-tree detector. Application deployment/reconciliation is outside this recipe.
- SDK checksum validation and explicit apply/open/force APIs remain unchanged.
  Package installation, agent behavior and benchmark preview remain unchanged.

## Alternatives

- Explicit prepare/open: selected; existing operations, no extra state owner.
- Retain the applied-ID selector and repair its forced deployment: rejected by
  the user amendment; requires the removed reconciliation policy.
