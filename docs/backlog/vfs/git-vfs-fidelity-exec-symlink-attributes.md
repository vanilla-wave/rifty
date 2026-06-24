---
area: vfs
status: parked
title: git VFS fidelity: executable bit, symlinks, attributes
created: 2026-06-23
why: Git object/tree SHA fidelity for real repositories depends on filesystem metadata and filters the current VFS/fs-adapter cannot represent.
user_story: As a developer cloning or editing real packages in rifty, I want executable files, symlinks, and `.gitattributes` line/filter rules to preserve canonical git behavior.
sources: [ADR-0050, ADR-0167, docs/public/compat/git.md, docs/backlog/shell/git-command-isomorphic.md]
code: [packages/vfs/src, packages/git/src/fs-adapter.ts, packages/git/src/git.ts]
---

## Contract

Add the lower-layer fidelity needed before claiming full tree-SHA parity for broader real repos:

- Executable bit: represent and persist `100755` vs `100644`; expose through the git fs adapter and preserve in tree writes/reads.
- Symlinks: represent symbolic links in VFS, expose `lstat`/`readlink`/`symlink`, and write/read git tree mode `120000`.
- Attributes/filters: implement the subset required for line-ending normalization (`text`, `eol`) and loudly reject unsupported clean/smudge filters until real filter execution exists.

## Non-Negotiables

- No mode lies: a file with unknown executable/symlink state must not be committed as if fidelity were known.
- No silent CRLF normalization gaps: `.gitattributes` rules either apply or throw a directed ceiling.
- No browser-only shortcuts that break canonical git object IDs.

## Acceptance

- Parity tests against real git for tree SHA with executable files, symlinks, and CRLF-normalized files.
- VFS conformance tests for metadata persistence across Memory VFS and OPFS-backed variants where applicable.
- Compat matrix rows move from ❌ to ✅/⚠️ only with concrete parity evidence.
