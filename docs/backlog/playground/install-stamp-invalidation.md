---
area: playground
status: draft
title: Open readable saved projects without certifying their install
created: 2026-06-12
why: absent or incompatible install trust currently blocks access to readable saved files and the terminal
user_story: As a developer reopening a saved Vite project after an interrupted npm install, I want my files and terminal to open without automatic installation, with dependency errors raised by the commands that actually use them.
epic: fault-honest-opfs-persistence
sources: [docs/adr/playground/0307-install-trust-is-an-install-protocol-commit-not-tree-surveillance.md, docs/adr/distribution/0394-apply-dependency-snapshots-through-catalog-transactions-and-saved-state-policy.md, docs/backlog/playground/reference/project-open-ide-boundaries-refine.md]
code: [packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

Saved snapshot admission calls `#trustedProvenance` and rejects the whole open
when it returns null. Manifest edits may retain live `owner-runtime` readiness,
then fail this check after reload. This is a source finding, not an executed
browser crash reproduction. The recorded native Node probe runs local source
despite a missing declared package and malformed lock; the missing `require`
fails at use. Full interrupted-install/browser proof remains for pickup.

## User scenario

Save an already working, snapshot-created Vite project. Run `npm install lodash`,
close the tab after install starts changing the tree but before completion, then
reopen the same project. Preserved sources and terminal remain accessible; no
implicit install or source snapshot restore. Commands execute against the saved
files; missing dependencies fail when used. The user may explicitly rerun
`npm install`. A pending/missing claim alone cannot block open or all Node commands.

## Boundaries

- Existing saved state is mutable, not a copy to revalidate against its initializer.
- Validate a supplied snapshot while applying it; retain its existing write/commit
  guarantees. Recover interrupted own catalog transactions before publishing a tree.
- Unreadable OPFS or unrecoverable own metadata remains a storage failure; this
  direction does not add partial storage recovery or certify torn writes as complete.
- Browser adapter incompatibility fails the capability that needs it. Never invent
  shadow bindings, promise unsupported execution, or block file access on that basis.
- Generic VFS, npm and runtime must not acquire IDE Scratch-dirty policy; companion
  ownership is captured separately in `scratch-dirty-ide-ownership.md`.

## Decisions

- 2026-09-10 — user: «да, ок, ровно поведение node», answering the exact Vite → interrupted `npm install lodash` → reopen files/terminal without auto-install scenario recorded in `reference/project-open-ide-boundaries-refine.md`.
- 2026-09-10 — reframe this existing draft: tree surveillance/automatic healing is not the requested outcome; retain the filename for incoming references.
- 2026-09-10 — before implementation, supersede the conflicting saved-open clause of ADR-0394 and review ADR-0261/0307/0309 admission clauses via DEC-2; this draft does not itself repeal those ADRs.
- 2026-09-10 — preserve baseline dirty meanings and storage recovery; no new user policy inferred from the ownership change.

## Challenge

2026-09-10 — fresh read-only `/root/review_open_boundary`:

> Направление обосновано; две оговорки: child runtime всё ещё зависит от install trust, а recovery собственных транзакций нужен при mount.

Full evidence and dispositions: `reference/project-open-ide-boundaries-refine.md`.
Removing only the saved-open guard would move the failure into child admission.
Runtime reconstruction, real browser/Node proof and minimal mechanism selection
remain agent-owned pickup work; no new coordinator is prescribed.
