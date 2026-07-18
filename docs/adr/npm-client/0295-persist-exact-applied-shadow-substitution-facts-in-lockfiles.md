# ADR 0295: Persist exact applied shadow substitution facts in lockfiles

Status: Accepted
Date: 2026-07

> TL;DR: npm-client writes its exact applied-substitution trace into
> `package-lock.json`; trusted/snapshot readiness plans only from that trace,
> never installed-name coincidence.

## Context

Fresh install owns an exact applied-substitution record, plan, and receipt.
Workbench trusted-existing and snapshot paths instead have only the exact
stored lockfile bytes. Reconstructing from an alias target is false provenance:
a user override can produce the same package tree without applying the builtin.
Putting the plan in the v4 stamp or Workbench snapshot would duplicate npm
semantics outside their producer and leave ordinary lockfile replay ambiguous.

## Decision

`buildLockfile` writes top-level
`rifty.shadowSubstitutions = {protocol:'rifty.lockfile-shadow-substitutions/v1',
applied:[...]}` on every npm-client install, including an empty trace. `applied`
is canonical installer-owned recipe evidence. Each row contains exactly
`substitutionId`, `runtimeAdapterId`, `publicName`, `requestedRange`, and
`resolvedPublicVersion`. `substitutionId` is the immutable installed-tree
recipe identity; a target/overlay/synthesis recipe change must mint a new id
and install-artifact identity. Resolver nodes, placements, callbacks, receipts,
catalog id/digest, descriptors, assets, and builtin flags are absent.

One internal deep module projects a current plan to that stable trace and
hydrates a stored trace into the current builtin plan. It exact-validates the
recipe and adapter binding, then supplies current catalog/descriptor facts.
Asset descriptor or catalog-digest changes therefore produce a new required-set
digest/receipt without changing lockfile or dependency-tree identity. Adapter
or recipe drift loud-throws rather than silently rebinding executable behavior.

An append-only recipe ledger owns historical `substitutionId -> public and
materialized package name` facts independently of active overrides. Missing-
trace ambiguity scans every historical public/target name; removing an alias
cannot reinterpret its old lockfile as asset-free. A traced plan must have its
recipe's matching materialized package/version in the tree. Alias retirement
adds a new recipe id/proof rule and retains the old tombstone.

The concrete npm-client lockfile-facts reader strictly validates v3 JSON, the
protocol, canonical trace, and matching materialized builtin target before
planning. Missing trace is empty only when the lockfile names neither a builtin
trigger nor target; an ambiguous legacy lockfile loud-throws
`NotImplementedError('npm-client.lockfile.shadowSubstitutionFacts')`. User
overrides retain an explicit empty trace even when their target bytes match a
builtin redirect.

The same object-level trace/tree validator joins `ShadowAssetInstallError`'s
snapshotted lockfile to its plan. Exact-byte and post-tree evidence therefore
cannot disagree about the materialized recipe target.

The public concrete exact-byte reader does not itself attest the bytes. The
Workbench package-private producer calls it only after v4 or snapshot byte
trust; there is no injected parser/catalog/producer interface.

The field participates in exact lockfile/v4/closure hashing. Eddy carries it in
the same lockfile bytes. The alias-retirement item still owns the separate
synthetic-package provenance recipe; it cannot forge this applied trace.

## Consequences

- Trusted, snapshot, fresh, replay, and Eddy paths share producer evidence.
- npm-compatible readers ignore the namespaced extension; npm-client validates
  it exactly.
- Existing ambiguous shadow lockfiles/snapshots need reinstall or rebake;
  returning an empty plan would lie.
- Any trace change changes lockfile and closure hashes by design.
- Asset-only catalog changes leave closure/tree identity stable and refresh
  only runtime-asset readiness.
