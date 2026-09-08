# ADR 0389: Publish a sealed Workbench dependency-snapshot producer

Status: Accepted
Date: 2026-09

> TL;DR: `@riftydev/workbench/dep-snapshot` is the sealed bake/restore entry; it writes caller manifest+lock, runs existing `install()`, and emits ADR-0386 tar plus identities.

## Context

Goal self-hosted-snapshot-workbench I1 requires a host CI to bake a standard
tar.gz from its own package.json + package-lock.json using published packages
only. Today's bake script imports private Workbench glue and playground
templates (ADR-0135). ADR-0386 owns the envelope; ADR-0346/0261 own replay
identity and install-artifact trust; ADR-0282 seals Workbench entrypoints;
ADR-0070 owns publish exports.

## Decision

Add sealed subpath `@riftydev/workbench/dep-snapshot`.

`produceDepSnapshot({ templateId, packageJsonText, packageLockText, registry })`
creates an internal Memory VFS, writes both caller texts, runs the existing
`install()` owner, then `buildDepSnapshot` + `serializeDepSnapshotTar`.
Return `{ tarBytes, snapshotId, installArtifactIdentity, snapshot }`.
`snapshotId` is SHA-256 of uncompressed tar bytes (ADR-0386). Registry is the
existing public `@riftydev/npm-client` `RegistryClient`; no auth helper.

The same entry re-exports restore/fetch/parse, `installArtifactIdentity`, and
`createDepSnapshotMemoryFs()` so a packed consumer restores without
`vfs/internal` or a checkout. Lockfile is written before install so ADR-0023
replay pins versions. Unsupported-package gates stay the installer's.

No CLI bin, no second installer, no new package. Playground bake may call this
entry; it is not the public contract.

Candidates: keep playground-private bake — violates I1 (checkout required);
new `@riftydev/dep-snapshot` package — extra publish surface without a new
owner; sealed Workbench subpath — same restore owner, ADR-0282 allowlist.

## Consequences

Embedder CI depends on published Workbench + npm-client only. Arbitrary
installed-tree import and private-registry auth remain out of scope.
