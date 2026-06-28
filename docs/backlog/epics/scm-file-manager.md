---
kind: epic
status: ready
title: Git-in-editor (SCM) + VS Code-style file manager over the owner
created: 2026-06-27
value: A graphical git surface (M/U/A/D-colored tree, Changes/Staged, gutter + side-by-side diff vs HEAD, stage/commit) AND in-tree file management (new/rename/delete/drag-drop/upload) — hand-rolled over the already-shipped @riftydev/git engine, no new dependency.
user_story: As a developer in the rifty playground, I want graphical git + in-tree file management, but today the editor has ZERO git UI (only a GitHub hyperlink) and the FileExplorer is a read-only viewer — every git action means the terminal and every file op means the terminal or a save.
items: [playground/git-owner-rpc-channel, playground/git-status-change-feed, playground/explorer-owner-write-frames-rename-copy, playground/explorer-owner-rpc-fs-target, playground/owner-routed-explorer-crud, playground/explorer-git-decorations, playground/explorer-dnd-upload-compare, playground/scm-readonly-panel, playground/scm-diff-original-content, playground/scm-actions-stage-commit]
---

## Outcome

Two requested IDE features — graphical git and a VS Code-style Explorer with
in-tree CRUD — are **one owner-side capability projected into two page views**.
Two architecture facts force this and force the build path:

1. **The page has zero git metadata and cannot write.** The owner→page snapshot
   EXCLUDES `.git` (and `node_modules`/`.vite`/`dist`) and inlines content only
   <128KB (`vfs-snapshot-port.ts` `SNAPSHOT_EXCLUDE_DIRS`/`SNAPSHOT_MAX_CONTENT_BYTES`);
   `SnapshotFs` is read-only and THROWS on every write (`snapshot-fs.ts`). So
   status, the HEAD/index original blob, log, diff, AND every CRUD mutation MUST
   route through owner RPC. The owner (ADR-0148/0150) is the single writer and the
   only realm where `.git` lives.

2. **rifty already owns the engine vscode.dev lacks.** `@riftydev/git` (ADR-0167,
   isomorphic-git over the VFS) is parity-proven: `status --porcelain` byte-exact
   vs git 2.50.1, commit SHA byte-identical, diff/show/log/branch/stash/merge. The
   owner ALREADY constructs `makeGit(ownerGitVfs())` and runs `.status()` at boot
   (`starter.ts`); `publishSnapshot()` already fires at every mutation point; the
   shell `git` builtin already classifies status into the staged-vs-worktree split
   (`porcelainXY`, `packages/shell/src/commands/git.ts:69`).

**The value is the graphical PROJECTION of an engine we already have**, which grows
the mission (real Node software in the browser: a credible local IDE loop —
edit → see changes → diff → commit — entirely in-browser, no server).

**Decision (settled): hand-rolled, zero new dependency.** The load-bearing work
(an owner git-RPC channel + a debounced status feed + an owner-routed write
mailbox + a HEAD-blob provider) is identical under ANY UI, because the page can
compute nothing git-related and cannot write. A vendored VS Code workbench/service
layer would be an IRREVERSIBLE editor-core swap (re-validating the shipped ADR-0166
ts.LanguageService Monaco-provider stack) for nothing load-bearing — and its
batteries are precisely the parts rifty cannot honestly back: a node-only bundled
git extension (a browser fake), and blame / 3-way merge editor / byte-exact patch /
a writable in-page FS (engine ceilings, compat ❌, or owner-SSoT violations).
StackBlitz (the closest sibling: a real in-browser runtime) made the same call —
Monaco + a hand-rolled shell + real engines over its runtime.

## User scenario

Done when a developer, entirely in-browser:

1. Edits a file → its filename turns orange with an **M** badge in the tree, and a
   **Changes** entry appears in the Source Control panel — within one feed tick, no
   terminal.
2. Opens **side-by-side "Open Changes" vs HEAD** and sees **gutter +/-/~** marks
   while editing — byte-honest (Monaco diffs two full blobs).
3. **Stages** the file, types a message, **commits** with Cmd+Enter — producing a
   commit SHA byte-identical to `git commit`; the branch chip in the status bar
   shows the current branch.
4. **Right-clicks a folder → New File**, F2-renames, deletes-with-confirm, and
   **drag-drops** a file to move it — every mutation applied by the owner and
   reflected back, never a page-local edit.

## Items

Foundation (build first — the UI-agnostic asset; both views are inert without it):

- `playground/git-owner-rpc-channel` — page↔owner request/reply git channel
  (owner handler CALLS `makeGit` verbs; page client clones the ts-lsp correlation).
- `playground/git-status-change-feed` — owner debounced + skip-if-unchanged
  `status()` feed on the existing `publishSnapshot` triggers; `{path,code}[]` delta;
  page status store. Highest leverage AND highest blast-radius (drives BOTH views).

File-manager projection:

- `playground/explorer-owner-write-frames-rename-copy` — atomic `rename`/`copy`
  frames on `VfsWriteFrame` (today write|mkdir|rm only).
- `playground/explorer-owner-rpc-fs-target` — page-side `OwnerRpcFs` (`FsOpsTarget`)
  emitting write frames; `SnapshotFs` stays read-only-throws.
- `playground/owner-routed-explorer-crud` — in-tree new/rename/delete affordances
  driving `OwnerRpcFs`.
- `playground/explorer-git-decorations` — per-row M/U/A/D color+badge from the feed.
- `playground/explorer-dnd-upload-compare` — drag-drop move, OS-upload, Copy Path,
  Compare (blob-vs-blob).

SCM projection:

- `playground/scm-readonly-panel` — Changes/Staged groups via `porcelainXY` +
  branch chip + commit-history list.
- `playground/scm-diff-original-content` — `rifty-git://` HEAD/index-blob provider →
  Monaco DiffEditor (gutter + side-by-side), blob-vs-blob ONLY.
- `playground/scm-actions-stage-commit` — owner-acked stage/unstage/discard/commit.

`blocked_by:` edges on each item carry the build order (foundation → projections).

## Done when (epic acceptance — binary, observable)

- [ ] File tree shows live M/U/A/D color+badge matching `git status` (rifty-git
      semantics), within one feed tick after any mutation.
- [ ] Read-only SCM panel: Changes + Staged via `porcelainXY`; branch chip;
      commit-history from `log()`.
- [ ] Gutter diff + side-by-side Open Changes vs HEAD, byte-honest via Monaco over
      two FULL blobs (HEAD blob from owner `show('HEAD:'+path)`).
- [ ] In-tree CRUD + drag-drop move + OS-upload, all owner-routed; `SnapshotFs`
      never writable; no page-local file store.
- [ ] stage/unstage/discard/commit from the panel; commit SHA byte-identical to
      shell `git commit` for identical inputs.
- [ ] Channel + feed + `OwnerRpcFs` keyed by `OwnerBridgeKey`; project switch
      (ADR-0165) tears down + rebinds; an action in the respawn window fails LOUDLY.
- [ ] Zero new prod dependency; `pnpm pr:check` green; real-screenshot `/verify`
      for the decorated tree + diff.

## Honesty invariants (Fidelity — every item inherits these)

- **No node-only bundled git extension** — the SCM impl is `@riftydev/git` over
  owner RPC; the bundled `vscode.git` (`child_process.spawn` of native git) is a
  browser fake.
- **No raw unified-diff text surface** — `@riftydev/git` diff hunks are structured
  LCS, NOT byte-exact git-diff text (`compat/git.md`). All diff UX is blob-vs-blob
  through Monaco; a "git diff" text view is a stub that lies.
- **Absent, not stubbed** — blame/GitLens, the 3-way merge editor +
  `--continue`/`--abort`, reflog/`HEAD@{n}` timeline, mode-change rows (mode fixed
  `100644`; an exec-bit/CRLF-only change shows CLEAN here vs MODIFIED in canonical
  git): omit them, or compat ❌ — never a dead/approximating control.
- **Conflicts surface the engine's loud throw** — `git.ts` `merge()`/`cherryPick()`
  bare-delegate to isomorphic-git; a conflict is a loud iso-git/shell-classified
  error, NOT a `NotImplementedError` from `git.ts`. Never a swallowing path.
- **Owner is the sole writer** — CRUD routes through `OwnerRpcFs` → write frames;
  `SnapshotFs` stays read-only and keeps throwing (Review #4 deleted a
  CRUD-on-throwing-snapshot lie — do not reintroduce).
- Decorations labeled `rifty-git status`, not exact-git parity.

## Out of scope

- Graphical clone/fetch/pull/push (engine has smart-HTTP; remote-ops UI is a
  deliberate follow-on, not core local working-tree state).
- Blame, merge-conflict resolution UI, rebase/am UI, GPG, submodules — engine
  ceilings (`compat/git.md`); stay loud ❌.

## Reversibility

REVERSIBLE as an epic and as each hand-rolled page-side projection (delete the
component). IRREVERSIBLE per item at implementation: a NEW cross-realm contract
(the git-owner-rpc channel, the git-status feed channel, the atomic rename/copy
write frames, the `rifty-git://` scheme) is new owner/page surface → CHANGELOG line
each, and an ADR where it mints a stable cross-package wire contract.
