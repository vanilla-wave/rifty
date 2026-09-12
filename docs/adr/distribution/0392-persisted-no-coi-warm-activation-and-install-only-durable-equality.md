# ADR 0392: Persisted no-COI warm activation and install-only durable equality

Status: Accepted (2026-09-08)

## Context

PR #321 goal I1–I4: opening preserves package edits; explicit install repairs.
ADR-0307 defines installation trust, not pristine dependency bytes.
ADR-0375 keeps generic package policy; ADR-0377 owns same-page restart.

## Decision

Expose `sandbox.toolchain.open({cwd, registryUrl})` with install's validation,
admission and error settlement. A fresh page validates saved installation
without installer, finalizer, network or dependency writes; activates runtime
adapters from the existing strict lock shadow-plan decoder. Return the existing
in-memory activation snapshot for same-page restart.

Reuse InstallStampAuthority's demote/install/fence/promote protocol and v4
manifest/lock/artifact checks. No separate binding receipt: lock shadow traces
already carry canonical adapter identity. No-COI policy version + registry URL
form the stamp slug; root remains separately bound. Missing/pending/old/mismatched
proof rejects with explicit-install-required and retains saved bytes. 0.6 no-COI
installs never minted this proof and require explicit install once.

Reserved stamp ingress remains protected before the runtime loader captures
its FsSync. Reuse the existing claim owner/guard; no guest write/copy may create
installation authority. Internal install alone receives claim capability.

Only the install adapter suppresses persistence. The OPFS owner consults its
existing pending scheduler and full failure ledger. Compare fresh native bytes
and current mirror bytes against nonempty incoming bytes; a mutable cached
Uint8Array is not durability evidence. A fresh native directory lookup plus
clean persistence permits skipping recursive mkdir. Dirty/unknown/empty paths
keep the ordinary write/heal/failure path. Generic fs operations remain ordinary.

## Candidates and evidence

- Always reinstall with dedup: killed by I2; repairs intentionally edited bytes.
- Separate persisted activation snapshot/receipt: duplicates lock bindings and
  existing stamp ordering. Source: no-coi-toolchain-install and
  npm-client/internal `planShadowSubstitutionsFromLockfile`.
- Existing stamp + strict lock decoder: selected; no second trust ledger.
- Cache-byte-only equality: killed by OpfsFsSync readFileBytesSync returning the
  cache by reference; alias mutation need not enqueue persistence.
- Durable byte ledger: unnecessary state; native read + existing scheduler/ledger
  proves the required skip without it. Native read cost remains measurable.

Executed baselines/RED: docs/backlog/distribution/reference/issue319-implementation-evidence.md;
original decisions: docs/backlog/distribution/reference/issue319-refine-evidence.md.

## Consequences

Public API/worker handshake changes together. No tree-hash surveillance, silent
repair on open, crash transaction, new retry owner, or npm repair parity claim.

## Corrections (active)

2026-09-10 — ADR-0417 supersedes the SDK saved-install certification/admission,
proof-miss explicit-install-required and mandatory old-proof reinstall clauses.
Nonmutating/network-free open, install-only durable equality and retained
consumers’ protected claim handling remain.
