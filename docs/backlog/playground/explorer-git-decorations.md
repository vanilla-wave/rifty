---
area: playground
status: ready
title: Git status decorations on the file tree (M/U/A/D color + badge)
created: 2026-06-27
why: The git-colored file tree is the headline "VS Code file manager" signal; FileExplorer today renders monochrome category icons with NO color/badge/decoration layer.
user_story: As a dev, I want filenames in the tree tinted + badged by git status (M modified, U untracked, A added, D deleted, staged color), but today the explorer shows no status at all — I must run git status in the terminal.
epic: scm-file-manager
blocked_by: [playground/git-status-change-feed]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/git-status-change-feed.md, ADR-0167, docs/public/compat/git.md]
code: [apps/playground/src/components/FileExplorer.tsx, packages/shell/src/commands/git.ts, packages/git/src/types.ts]
---

## Context

`FileExplorer.tsx` (~245 LOC) renders monochrome category icons, no per-row status
class/badge. The status data comes from the shared `path→code` store fed by
`git-status-change-feed` (which lifts `porcelainXY` from the shell). This is the
file-manager projection of the SAME feed that drives the SCM panel — pure
presentation, zero fidelity risk in itself, zero new deps.

## Scope

- **In:** a per-row color class + M/U/A/D badge driven by the page status Map,
  refreshed on the feed tick; theme colors matching `gitDecoration.*ResourceForeground`;
  ancestor-folder propagation (a changed child tints its folders).
- **Out:** the status feed itself (`git-status-change-feed`); the SCM list
  (`scm-readonly-panel`).

## Guardrails

- **No mode-change decoration** — mode is fixed `100644`; a file differing only by
  exec-bit/CRLF is CLEAN here vs MODIFIED in canonical git. Render only the honest
  M/U/A/D content codes; label the surface `rifty-git status`, not exact-git parity.
- Driven by the shared feed only — the explorer computes no git itself.

## Acceptance

- Real-screenshot `/verify` (selector e2e misses missing CSS): editing a file
  colors + badges its row within one feed tick; a new file shows the untracked
  color; staged shows the index color; folders propagate.

## Parity cases

- A tracked file edited → its row gets the `M` color/badge matching `porcelainXY`
  ` M`; a new file → the untracked color (`??`); a staged file → the index/staged
  color (`A `/`M `); a deleted file → `D`.
- Ancestor folders of a changed file are tinted (propagation); a clean file/folder
  carries no decoration.
- Colors map to `gitDecoration.*ResourceForeground` theme tokens.

## Out of scope

- Mode-change decoration (exec-bit/CRLF) → never rendered (mode fixed `100644`);
  such a file is CLEAN here vs MODIFIED in canonical git, compat ❌.
- Exact-git color/letter parity → the surface is labeled `rifty-git status`, not
  canonical-git.
- Computing git in the explorer → forbidden; decorations read ONLY the shared feed
  store.

## Decisions

- Per-row color class + M/U/A/D badge from the page `path→code` Map, refreshed on
  each feed tick; folder propagation.
- Presentational only; verified by real-screenshot `/verify` (selector e2e misses
  missing CSS).
- REVERSIBLE, CHANGELOG line, no ADR.

## Reversibility

REVERSIBLE — presentational layer over the shared store. CHANGELOG line.
