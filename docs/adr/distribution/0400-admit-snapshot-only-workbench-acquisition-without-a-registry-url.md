# ADR 0400: Admit snapshot-only Workbench acquisition without a registry URL

Status: Accepted
Date: 2026-09
Refines: ADR-0263, ADR-0261, ADR-0346, ADR-0396

> TL;DR: Omitted `packageAcquisition.registryUrl` (and omitted Eddy) is
> snapshot-only admission; a required snapshot that cannot restore fails
> before guest start and never becomes a deferred network install.

## Context

Goal self-hosted-snapshot-workbench I3. ADR-0263 requires a validating
`registryUrl`. Public first-materialization catches internal
`snapshot-unavailable` and returns `kind: 'install'`. Goal rejected route:
fake registry URL or automatic install on snapshot rejection.

I8 (ADR-0396) already owns when a snapshot is required. This ADR owns
registry admission and the no-install-on-rejection rule.

## Decision

`packageAcquisition.registryUrl` is optional. Omitted registryUrl and omitted
`eddy` is snapshot-only: restore uses existing snapshot/acquisition owners;
zero registry/Eddy requests. `eddy` still requires `registryUrl`.

A required snapshot (I8 apply, or first seed of an absent project) that is
missing, corrupt, id-mismatched, template-mismatched, or otherwise
unrestorable rejects before guest start. It does not become deferred
`kind: 'install'`. Unused new snapshot under initial-only still does not
fetch or block (ADR-0396).

Registry-present acquisition keeps today's deferred-install fallback.
Terminal/package APIs in snapshot-only mode do not start a network install;
replay from exact available bytes may work, absent bytes fail loudly.

No second acquisition coordinator. Retired `packageAcquisition.snapshotUrl`
stays retired.

Candidates: omit registryUrl = snapshot-only (selected; smallest public
shape). Explicit `mode: 'snapshot-only'` (killed: extra knob the omit already
states). Placeholder registry URL (killed: goal rejected route).

## Consequences

Embedders boot from a baked snapshot without a browser registry. I7's packed
host proof uses this admission. Registry-backed playground stays unchanged.
