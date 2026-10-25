# ADR 0386: Publish deterministic dependency snapshot archives

Status: Accepted
Date: 2026-09

## Context

Goal self-hosted-snapshot-workbench I1 requires ordinary tar.gz inspection and
collision-free project/control namespaces. ADR-0346 owns snapshot identity and
replay trust; its v3 JSON reader remains supported.

## Decision

New snapshots use a deterministic POSIX tar envelope: `payload/` contains
project-relative files; `rifty/manifest.json` contains version 4, templateId,
packages, deps and installArtifactIdentity; `rifty/replay-cache/` contains the
exact integrity-pinned replay closure. Metadata never enters payload.
Regular files and directories only; PAX path records carry long UTF-8 names.
Sort names by code unit, mode 0644/0755, uid/gid/mtime zero, empty owner names.
SnapshotId remains SHA-256 of uncompressed bytes; gzip is transport encoding.

Validate complete container paths, checksums, types, collisions and envelope
before restore; retain existing body caps, install identity and replay checks.
The codec reuses the existing snapshot restore owner. No second installer or
transaction coordinator. Empty directories remain explicit.

Candidates: keep gzipped JSON — violates ordinary-tool inspection (I1);
metadata in project root — collides with admitted user paths (I1); separate
payload/control tar branches — standard tools extract the namespace probe
recorded in distribution/reference/embedder-gaps-evidence.md.

## Consequences

Legacy v3 JSON/gzip assets remain usable. The producer will emit this envelope;
no arbitrary installed-tree import or new package compatibility is implied.
