# ADR 0398: Select registry-free snapshot acquisition through the existing package owner

Status: Accepted
Date: 2026-09

## Context

Goal I3 requires explicit snapshot-only operation without a registry URL or
browser registry/Eddy acquisition. I8/ADR-0394 still owns when an incoming
snapshot may affect saved files. Independent DEC-2 research:
docs/backlog/distribution/reference/workbench-snapshot-only-pickup.md.

## Decision

1. Public `packageAcquisition` is a closed union: old
   `{mode?: 'registry', registryUrl, eddy?}` or `{mode: 'snapshot-only'}`.
   Snapshot-only rejects registryUrl/Eddy fields. Normalize once to explicit
   mode across the owner wire; no default URL lookup or RegistryClient exists
   in the snapshot-only branch. Supersedes ADR-0263's required-registry/no-mode
   and unconditional-correctness-fallback clauses only.
2. The existing package actor enforces owner policy across automatic, direct
   and deferred materialization entries. Trusted saved state and verified
   snapshots remain available; a required unavailable snapshot or install
   rejects before guest admission. Preserve concrete snapshot failure reasons
   in public error messages. Supersedes ADR-0278's unconditional deferred
   install on snapshot rejection; its registry-enabled branch remains.
3. Explicit package/terminal install uses the same installer with a genuinely
   optional `InstallOptions.registry`. Existing lock/cache resolution remains;
   required packument/tarball misses throw `NotImplementedError` for unavailable
   registry acquisition. All overloads recognize options without registry.
   No dummy client, second installer or new mutation/claim authority. This is
   not npm `--offline`, general guest-network isolation or atomic install.
4. Absent registry plus configured Eddy rejects before resolver/prefetch/pin
   callbacks. Snapshot-only owner composition supplies none of these
   capabilities. Optional-dependency warning/skip semantics remain. Local
   scripts, lifecycle aliases, installed bins, prefix selection and guest
   application network keep their existing contracts.
5. ADR-0023 network misses/refetch and ADR-0182 standard fallback apply when a
   registry is configured; neither can manufacture an absent capability.
   Their configured-registry resolution, integrity and accelerator contracts
   remain. ADR-0394 admission receipts, saved priority, conflict policy and
   transaction/rollback ownership remain unchanged.

## Alternatives and evidence

- Omission-only policy switch is smaller, but silently makes old invalid
  missing-URL input select a new policy. Explicit mode preserves existing
  caller validation and expresses the user-selected I3 operation.
- Separate offline flag with mandatory URL duplicates the decision and needs
  the dummy URL rejected by I3.
- Reject every explicit install: zero egress, but discards already-working
  local replay. Executed baseline four-argument installer replay succeeds
  with actual absent registry, real lock/cache and ms tarball; missing
  capability handling belongs at its two network misses. Preparation evidence:
  docs/backlog/distribution/reference/workbench-snapshot-only-evidence.md.
- A denying RegistryClient pretends a capability exists; another offline
  resolver duplicates the existing algorithm. Neither is required.

## Proof

Closed public/owner shapes, real owner/catalog admission and alternate-call
REDs; real installer overload/cache/fault carriers; mandatory packed public
producer Vite build/dev and saved-state proof with hostile registry counters.
This changes host acquisition policy, not Node/npm resolution semantics.
