---
area: playground
status: ready
title: Read-only SCM panel — Changes/Staged groups, branch chip, commit history
created: 2026-06-27
why: A graphical "what changed" surface is the single highest-frequency git interaction; today it requires git status / git branch / git log in the terminal and there is no SCM UI in the editor.
user_story: As a dev, I want a Source Control sidebar showing Staged + Changes groups and a branch chip, plus a commit-history list, but today the only git surface in the playground is a GitHub hyperlink.
epic: scm-file-manager
blocked_by: [playground/git-owner-rpc-channel, playground/git-status-change-feed]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/git-owner-rpc-channel.md, docs/backlog/playground/git-status-change-feed.md, docs/backlog/playground/scm-diff-original-content.md, ADR-0075, ADR-0167, docs/public/compat/git.md]
code: [apps/playground/src/App.tsx, apps/playground/src/components/FileExplorer.tsx, packages/shell/src/commands/git.ts, packages/git/src/git.ts]
---

## Context

Hand-rolled SCM sidebar inside the existing ADR-0075 shell (activity-bar/sidebar/
status-bar), zero new dep. Feeds: the shared status store (`git-status-change-feed`)
for the resource groups, the git-RPC channel for `currentBranch()`/`log()`. The
staged-vs-worktree split is the existing `porcelainXY` mapping
(`packages/shell/src/commands/git.ts:69`). The status bar (ADR-0075) hosts the
branch chip.

## Scope

- **In:** a Source Control view: `Staged Changes` + `Changes` groups (rows from
  the `porcelainXY` split), per-row status letter + a click opening the diff
  (`scm-diff-original-content`); a branch chip in the status bar from
  `currentBranch()`; a commit-history list from `log(LogOptions)` (subject, author,
  short-oid, newest-first).
- **Out:** actions (`scm-actions-stage-commit`); the diff editor
  (`scm-diff-original-content`); decorations on the tree
  (`explorer-git-decorations`). READ-ONLY here.

## Guardrails

- **Honest absences:** no blame, no `HEAD@{n}`/reflog timeline, no 3-way merge
  editor — omit entirely (engine ceilings, `compat/git.md`). No control claims a
  capability the engine lacks.
- Render only the shared feed + RPC reads; compute no git page-side.
- Rebinds on owner respawn; clears on project switch (ADR-0165).

## Acceptance

- E2E (real screenshot — selector e2e misses missing CSS): edit a file → it
  appears under Changes within one feed tick; the branch chip matches `git branch`;
  the history list matches `git log --oneline`. Audit: no stubbed blame/merge/timeline.

## Parity cases

- The `Staged Changes` / `Changes` split matches `porcelainXY` (staged column vs
  worktree column) of the engine `status()`.
- The branch chip equals `currentBranch()` (= `git branch --show-current`).
- The commit-history list equals `log(LogOptions)` order/subjects/short-oids
  (newest-first, matching `git log --oneline`).

## Out of scope

- Blame / `HEAD@{n}` reflog timeline / 3-way merge editor → omitted entirely
  (engine ceilings, compat ❌); no control claims them.
- Actions stage/commit (`scm-actions-stage-commit`); the diff editor
  (`scm-diff-original-content`); tree decorations (`explorer-git-decorations`).
  READ-ONLY here.
- Computing git page-side → forbidden; renders only the shared feed + RPC reads.

## Decisions

- Hand-rolled view inside the ADR-0075 shell (activity-bar/sidebar/status-bar),
  zero new dep; branch chip in the status bar.
- Feeds: the shared status store (resource groups) + the git-RPC channel
  (`currentBranch()`/`log()`).
- Rebinds on owner respawn; clears on project switch (ADR-0165). REVERSIBLE,
  CHANGELOG line, no ADR.

## Reversibility

REVERSIBLE — hand-rolled view over the shared feed + RPC; deletable component.
CHANGELOG line.
