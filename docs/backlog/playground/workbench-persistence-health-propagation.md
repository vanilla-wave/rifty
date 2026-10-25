---
area: playground
status: draft
title: Session-tool persistence failures degrade Workbench health
created: 2026-10-25
why: an SCM mutation or archive import whose owner flush fails rejects the call, but no path projects that failure into Workbench persistence health before the next save, unlike `awaitDurability`
user_story: As a developer whose browser storage fails during a Git action or archive import, I want Workbench to warn that reload may lose the change, but today global health may stay healthy after the failed tool call.
sources: [ADR-0278, PR-158-salvage-2026-10-25]
code: [packages/workbench/src/workbench/internal/playground-workbench.ts, packages/workbench/src/workers/playground-session-tools-owner.ts, packages/workbench/src/workers/playground-archive-integration.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/open-workbench.ts]
---

## Context

Salvaged from PR #158 (2026-07-19 audit draft, then under
`apps/playground/src/workbench`); re-read on main `7d038adb0`, code-read only,
no repro.

- SCM mutations (stage, unstage, discard, commit via `mutateScm`,
  `playground-session-tools-owner.ts:313-332`, callers `:345-362`) end in
  `settleScmMutation`, which throws the `authority.flush()` persistence
  failure (`:195-203`).
- Archive import rejects from `requireDurable`
  (`playground-archive-integration.ts:133-143`) with a plain `Error`, not the
  named persistence failure (`playground-session-tools-owner.ts:75`), so an
  `isPlaygroundPersistenceFailure` gate would not classify it; a drain
  failure beside an operation failure becomes an `AggregateError`
  (`settleArchiveOperation`, `:145-160`).
- The page session passes `scm`/`archive` through raw; only `awaitDurability`
  degrades `persistence` health (`playground-workbench.ts:160-180`). The other
  source, project-VFS durability state
  (`workbench-browser-owner.ts:742-748` → `open-workbench.ts:295-303`), fires
  only from page-side document commits.

Epic `fault-honest-opfs-persistence` owns flush mechanics and reload
consistency; `vfs/iso-git-ref-torn-write-rows` owns SCM ref torn writes. This
item owns only the live health signal for session tools.

## Question

Which one current-session projection turns a failed SCM/archive flush into
`persistence` degradation and recovery, without inferring durability from a
successful memory mutation, and how is the archive failure classified?
Settled at PICKUP with RED for quota/permission failure during stage, unstage,
discard, commit and archive import.
