---
area: playground
status: draft
title: Owner git-status change feed (debounced status() → {path,code}[] delta)
created: 2026-06-27
why: The git-colored tree AND the SCM Changes/Staged list are one status stream; it can only originate owner-side (page has no .git), and a naive per-save status() would jank the owner. This is the highest-leverage AND highest-blast-radius component — it drives BOTH features.
user_story: As the file tree + SCM panel, I want a live status map (path→code) pushed from the owner after each mutation, but today status() runs only at boot (starter.ts) and there is no runtime feed — and there are no VFS change events.
epic: scm-file-manager
blocked_by: []
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/git-owner-rpc-channel.md, docs/backlog/playground/explorer-git-decorations.md, docs/backlog/playground/scm-readonly-panel.md, ADR-0148, ADR-0165, ADR-0167, docs/backlog/vfs/vfs-change-events.md, docs/public/compat/git.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/vfs-snapshot-port.ts, apps/playground/src/components/FileExplorer.tsx, packages/shell/src/commands/git.ts, packages/git/src/git.ts]
---

## Context

The recompute TRIGGERS already exist: `publishSnapshot()` fires at every mutation
point (`real-vite-bootstrap.ts`: pty:exit `:414`, dev-server `onSnapshotDirty
:519`, editor-save `onVfsWrite :533-534`, node_modules `:733`, index-restore).
`status()` is parity-proven byte-exact and already honors `.gitignore` (so
`node_modules` won't flood). The classifier exists: `porcelainXY`
(`packages/shell/src/commands/git.ts:69`) maps each `StatusEntry` 3-char code to
the staged/worktree letters (`020→??`, `022→A `, `122→M `, `121→ M`, `101→ D`) —
lift it into a page-shared module.

There are NO VFS change events (`FileExplorer` signature-polls 1.5s) and `.git` is
excluded from the snapshot — so this is an honest **recompute-on-mutation** feed,
NOT a live fs watcher.

## Scope

- **In:** colocate a `status()` recompute with `publishSnapshot`, **trailing-edge
  debounced 150–300ms** and **skip-if-unchanged** (hash the list like
  `FileExplorer` `lastSig`). Emit a compact `{path,code}[]` delta on a NEW
  OwnerBridgeKey-keyed BroadcastChannel. Page caches a `path→code` Map (the shared
  store both projections read). Lift `porcelainXY` to a shared module.
- **Out:** the decoration DOM (`explorer-git-decorations`); the SCM list
  (`scm-readonly-panel`); request/reply git calls (`git-owner-rpc-channel`).

## Guardrails

- **Perf is mandatory, not optional:** debounce + skip-if-unchanged; recompute
  only off the existing `publishSnapshot` triggers, never a new per-write path
  (owner also supervises the dev server + LS). RED-check: a save burst coalesces
  into ONE recompute on a cloned repo without jank.
- **Honest staleness:** the feed is recompute-on-mutation + the 1.5s poll cadence,
  never advertised as a live watcher (no VFS events exist).
- **rifty-git semantics, not exact git:** mode fixed `100644` → exec-bit/CRLF-only
  changes show CLEAN here vs MODIFIED in canonical git; never emit a mode-change
  code. Label the feed `rifty-git status`.
- Keyed by `OwnerBridgeKey`; torn down + rebound on owner respawn (ADR-0165); page
  store cleared on switch (like `SnapshotFs.clear()`).

## Acceptance

- A status delta arrives after editor save / pty:exit / npm; a save burst →
  exactly one coalesced recompute; identical results do not republish;
  `node_modules` does not flood; channel torn down + re-established on respawn; no
  owner jank under rapid saves on a cloned repo.

## Reversibility

IRREVERSIBLE on merge (new owner→page channel + a new owner recompute path).
CHANGELOG line; ADR if the delta wire shape stabilizes cross-package. The page
store + DOM consumers are REVERSIBLE.
