---
area: playground
status: ready
title: Explorer clipboard — Copy/Cut/Paste/Duplicate (consumes the owner copy frame)
created: 2026-06-28
why: A file manager that can't copy/duplicate/cut-paste is not "any file manipulation"; the owner copy frame (explorer-owner-write-frames-rename-copy) ships with NO consumer today — a dangling capability. This is its honest consumer.
user_story: As a dev, I want Ctrl+C/Ctrl+X/Ctrl+V and right-click Copy/Cut/Paste/Duplicate in the tree, with copy→owner copy frame and cut→owner rename(move) frame, but today the explorer is a read-only viewer and the only copy/move is terminal cp/mv.
epic: scm-file-manager
blocked_by: [playground/explorer-owner-write-frames-rename-copy, playground/explorer-owner-rpc-fs-target, playground/owner-routed-explorer-crud]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/explorer-owner-write-frames-rename-copy.md, docs/backlog/playground/explorer-owner-rpc-fs-target.md, docs/backlog/playground/owner-routed-explorer-crud.md, ADR-0148, ADR-0150, ADR-0165]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/fs-ops.ts, apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/realVite.ts]
---

## Context

`explorer-owner-write-frames-rename-copy` adds atomic `rename` + `copy` frames to
the owner write mailbox; `explorer-owner-rpc-fs-target` (`OwnerRpcFs`) emits them;
`owner-routed-explorer-crud` hosts the per-row/context-menu affordances. THIS item
is the clipboard model + its affordances driving those frames — and the only
consumer of the `copy` frame (without it the copy variant is a dangling capability,
a honesty-smell). Cut-paste = an atomic `rename`(move) frame (NOT copyTree+rm across
two frames). Copy-paste / Duplicate = a `copy` frame. `glue/fs-ops`
(`copyTree`/`renamePath`) primitives already exist and operate on `OwnerRpcFs`.

## Scope

- **In:** a page-side clipboard model `{paths: string[], mode: 'copy'|'cut'}`;
  Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V + context-menu Copy/Cut/Paste/Duplicate;
  paste resolves the target dir (selected folder, else parent of selection);
  copy→`copy` frame, cut→`rename`(move) frame, all via `OwnerRpcFs`; same-dir
  collision → VS Code auto-rename (`name copy.ext`, then `name copy 2.ext`);
  Duplicate = copy into the same dir with auto-rename; cut visually dims source
  rows; a completed cut-paste clears the clipboard (a copy-paste keeps it).
- **Out:** the frames/`OwnerRpcFs` themselves (sibling items); OS-file paste/upload
  (that is `explorer-dnd-upload-compare`'s drag-upload path); drag-move (dnd item).

## Guardrails

- **Cut-paste is the ATOMIC rename frame** — never a copyTree+rm split (half-move
  hazard). Copy/Duplicate is the `copy` frame.
- **Owner-SSoT** — every mutation via `OwnerRpcFs` frames; `SnapshotFs` stays
  read-only; no page-local store; no optimistic mutation before owner ack/republish.
- An action during the owner-respawn window fails LOUDLY (owner-exited guard);
  clipboard state cleared on project switch (ADR-0165).

## Acceptance

- E2E: copy a file → paste into another folder → both copies exist owner-side
  (reflected in `SnapshotFs` within one publish); cut a file → paste → it MOVED
  (gone from source, present at target), atomically; Duplicate produces
  `name copy.ext`; a second Duplicate produces `name copy 2.ext`; cut rows dim;
  cut-paste clears the clipboard; an action in the respawn window fails loudly.

## Parity cases

- Cut-then-paste of `a/f.ts` into `b/` yields exactly the tree of `git mv a/f.ts
  b/f.ts` would (file at `b/f.ts`, absent at `a/f.ts`) — and its `status` code is
  the rename/delete+add the engine reports, never a half-state.
- Copy-paste of `f.ts` into a dir already containing `f.ts` produces
  `f copy.ts`; a further copy-paste produces `f copy 2.ts` (VS Code naming),
  never a silent overwrite.
- Copy of a directory recurses (every descendant present at the target with
  identical bytes) — matching `cp -r` content, never a shallow/empty dir.
- Paste of a `cut` item a second time is a no-op/error (clipboard already cleared),
  never a phantom second move.

## Out of scope

- **OS-clipboard file paste** (paste files copied in the OS file manager) — the
  browser cannot read OS file paths; importing OS files is drag-upload
  (`explorer-dnd-upload-compare`). A Ctrl+V of OS-clipboard files here is a no-op,
  NOT a fake import.
- **Overwrite-on-paste** (replacing an existing target instead of auto-renaming) →
  not offered; collisions always auto-rename or refuse, never clobber.
- **chmod/exec-bit/symlink preservation on copy** — mode is fixed `100644` (engine
  ceiling); copies are plain `100644` content copies, compat ❌; never claim mode
  fidelity.

## Decisions

- Clipboard is page-side ephemeral state (paths + mode); the MUTATION is always an
  owner `copy`/`rename` frame — page holds no authoritative fs (ADR-0148/0150).
- Cut-paste maps to the atomic `rename`(move) frame, NOT a copy+delete pair.
- Collision naming matches VS Code (`name copy.ext` / `name copy N.ext`).
- App-internal affordance over existing frames → REVERSIBLE, CHANGELOG line, no ADR.

## Reversibility

REVERSIBLE — additive page-side clipboard + affordances over the shipped
`OwnerRpcFs`/frames; deletable. CHANGELOG line.
