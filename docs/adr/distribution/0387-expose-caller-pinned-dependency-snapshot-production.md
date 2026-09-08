# ADR 0387: Expose caller-pinned dependency snapshot production

Status: Accepted
Date: 2026-09

## Context

Goal self-hosted-snapshot-workbench I1 requires baking from installed packages.
ADR-0386 owns the tar envelope; ADR-0346 owns snapshot identity/replay trust.
Ordinary install can repair missing/drifted lock pins. Blanket metadata denial
also rejects supported native-to-WASM substitutions.

## Decision

Export `produceDependencySnapshot({packageJsonText, packageLockText, registryUrl,
templateId})` from Workbench root. Return `archive` (tar.gz Uint8Array),
`snapshotId`, `installArtifactIdentity`. No Node-only subpath, CLI or new dependency.
Use the shared manifest serializer and existing installer in disposable Memory
VFS, then ADR-0386 serialization and CompressionStream. Caller files are not written.

Require a valid v3 lock with root dependency maps matching the manifest;
legacy unsupported lock versions stay loud. Use the configured registry fetch
adapter; no Eddy or builder-owned authentication.

Before emitting, every ordinary output lock entry must match a caller entry
at the exact path in version/resolved/integrity. New paths are permitted only
for the actual attested shadow materialization, fixed acquisition and validated
bundled children. An existing acquisition pin still must match. Materialization
uses the existing attested native substitution policy. Reuse npm-client's
internal path/projection validators; never infer trust from a path or inBundle.
Old unused/native entries may be pruned by the existing installer.

Candidates: a new frozen resolver — duplicates installer authority; disallow
metadata — real Vite8 lock requires lightningcss-wasm acquisition; verify
emitted pins and existing attested policy paths — the real Vite8 probe passes
20 packages. Refusal of newly resolved ordinary output pins is an acceptance
target carried by the ms/debug producer REDs, not a measured result of that probe.

## Consequences

No new package compatibility: unsupported packages, incomplete ordinary pins
or unpinned extra source closures fail visibly. Network work may precede that
failure; no artifact is emitted. Public browser restore remains the existing
snapshot-backed project definition and acquisition path.
