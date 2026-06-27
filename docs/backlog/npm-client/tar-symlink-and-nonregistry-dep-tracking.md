---
area: npm-client
status: draft
title: Unpacker tar-symlink + installer non-registry dep-spec throws lack a backlog item enumerating the supported-install contract
created: 2026-06-13
why: The tar-symlink throw cites 'M12' with no tracking file. The dependency-spec throws are now documented in public package-tooling compat, but this item still owns the fuller supported-install contract and tar-symlink tracking.
user_story: As a developer installing a dep via `file:`/`workspace:`/`git+`/`npm:` alias or a tarball with symlinks, I want a clear statement of what npm-client supports, but today each just throws `NotImplementedError` with no documented contract telling me only registry semver/tag installs work
sources: [ADR-0042, ADR-0051]
code: [packages/npm-client/src/unpacker.ts, packages/npm-client/src/installer.ts, packages/npm-client/src/unpacker.test.ts, packages/npm-client/src/installer.test.ts]
---

## Context

unpacker.ts throws NotImplementedError('npm-client.tar.symlink','tar symlinks not supported until M12') for tar typeflag '2' (tested). installer.ts (assertRegistryDependencySpecs/assertRegistryOverrideTargets) throws 'npm-client.dependency-spec.<file|workspace|git|http-tarball|npm-alias>' for non-registry specs, including local paths (`.`, `..`, `../x`) and GitHub shorthand (`owner/repo`); package-tooling compat now has a public ❌ row for that ceiling. installer.ts readStringRecord throws 'npm-client.package-json.<field>' for nested/non-string entries. The remaining tracking gap is the broader supported-install contract and the tar symlink relationship to the VFS symlink gate. The 'M12' label matches runtime-wasi/vfs-symlinks.md (VFS symlink layer deferred to M12) but no item ties the npm-unpacker rejection to it. The lifecycle-script throw is already covered by postinstall-scripts.md.

## Options or Next

Keep this item as the fuller contract/backlog anchor: registry semver/tag only; deliberately unsupported set includes tar symlinks, file:/link:/local paths, workspace:, git+/GitHub shorthand, http(s) tarball URLs, npm: aliases, nested/non-string dep entries. Anchor TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking) at the throw sites. Cross-link the symlink throw to runtime-wasi/vfs-symlinks.md (shared M12 VFS-symlink gate). Exclude lifecycle scripts.

## Reversibility

REVERSIBLE — backlog item only; no public-API or ADR change. Implementing any spec later may be IRREVERSIBLE and need its own ADR, but tracking is reversible.
