---
area: npm-client
status: active
title: Unpacker tar-symlink + installer non-registry dep-spec throws lack a backlog item enumerating the supported-install contract
created: 2026-06-13
why: The tar-symlink throw cites 'M12' with no tracking file, and the dependency-spec throws (file/workspace/git/http-tarball/npm-alias) plus the nested/non-string package.json throw have no backlog item enumerating the supported-install contract or a compat entry.
sources: [ADR-0042, ADR-0051]
code: [packages/npm-client/src/unpacker.ts, packages/npm-client/src/installer.ts, packages/npm-client/src/unpacker.test.ts, packages/npm-client/src/installer.test.ts]
---

## Context

unpacker.ts:70-75 throws NotImplementedError('npm-client.tar.symlink','tar symlinks not supported until M12') for tar typeflag '2' (tested). installer.ts:326-363 (assertRegistryDependencySpecs/assertRegistryOverrideTargets) throws 'npm-client.dependency-spec.<file|workspace|git|http-tarball|npm-alias>' (tested). installer.ts:299-316 (readStringRecord) throws 'npm-client.package-json.<field>' for nested/non-string entries. No backlog or compat doc covers any of these. The 'M12' label matches runtime-wasi/vfs-symlinks.md (VFS symlink layer deferred to M12) but no item ties the npm-unpacker rejection to it. The lifecycle-script throw is already covered by postinstall-scripts.md.

## Options or Next

Add this item enumerating the supported-install contract (registry semver/tag only) and the deliberately-unsupported set: tar symlinks, file:/link:, workspace:, git+, http(s) tarball URLs, npm: aliases, nested/non-string dep entries. Anchor TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking) at the throw sites. Cross-link the symlink throw to runtime-wasi/vfs-symlinks.md (shared M12 VFS-symlink gate). Optionally add an npm-client compat row when a compat doc lands. Exclude lifecycle scripts.

## Reversibility

REVERSIBLE — backlog item only; no public-API or ADR change. Implementing any spec later may be IRREVERSIBLE and need its own ADR, but tracking is reversible.
