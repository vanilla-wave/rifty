---
area: distribution
status: draft
title: Workbench guest VFS namespace — one project cannot reach another project's storage
created: 2026-07-15
why: the Workbench child mutation adapter receives the active project root but ignores it; terminal and child paths therefore address the lifetime-wide owner VFS, so parent traversal or an absolute path can read or mutate inactive project trees and Workbench metadata
user_story: As a developer using several projects in one browser Workbench, I want a Node program or CLI in the active project to see one honest filesystem namespace and never modify another project's retained files by escaping its cwd.
epic: embeddable-dev-loop
sources: [ADR-0263, docs/backlog/distribution/workbench-controllers.md]
code: [apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/workers/workbench-owner-bootstrap.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/shell/src]
---

## Context

`applyPackageAwareVfsMutations(mutations, _root, ...)` serializes package state
but does not enforce `_root`. The active Shell and child `node:fs` share the
lifetime owner authority, which also stores inactive Workbench projects and
owner metadata. This is project-state fidelity, not a multi-tenant security
claim: one program can surprise its user by changing a different retained
project in the same browser environment.

The correct Node-visible namespace is undecided. Choose and record one model:
a project-rooted virtual `/`, or an OS-like shared root with explicit protected
mounts and Node-shaped boundary errors. Do not add a mutation-only path check;
reads, cwd changes, Shell, child RPC, WASI, packages, and future companion tools
must observe the same namespace.

## Acceptance draft

- Decide the guest-visible absolute-root/mount model in an ADR and parity cases.
- Prove read/write/mkdir/rm/rename/copy/utimes plus `cwd`/parent traversal cannot
  reach an inactive project or Workbench metadata outside that model.
- Preserve legitimate absolute project paths, package installation, and
  recursive child/Worker behavior through the same namespace authority.
- Rejected operations change no owner revision, journal record, package claim,
  or retained project bytes; errors expose no private physical project root.
- Browser test: mutate project A with escape paths, reopen B, B is byte-exact.

## Out of scope

- Hostile-code containment, origins, permissions, or multi-tenant isolation.
- Changing the owner-applied mutation journal or Documents ordering.
- Silent path rewriting or best-effort filtering.
