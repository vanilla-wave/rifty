---
area: runtime-js
status: draft
title: fs.cp file→dir / dir→file overwrite uses wrong error codes
created: 2026-06-21
why: copying a file onto an existing directory (or a directory onto an existing file) throws the VFS's generic EISDIR/EEXIST instead of Node's specific ERR_FS_CP_NON_DIR_TO_DIR / ERR_FS_CP_DIR_TO_NON_DIR — a pre-existing divergence in the cp fast path (VFS cpSync), not the PR #62 edge-option path.
user_story: As a developer, I want `fs.cpSync(file, existingDir)` to throw `ERR_FS_CP_NON_DIR_TO_DIR` and `fs.cpSync(dir, existingFile, {recursive:true})` to throw `ERR_FS_CP_DIR_TO_NON_DIR` (Node), but today the no-edge-option fast path delegates to `syncMirror().cpSync`, which surfaces `EISDIR`/`EEXIST`.
sources: [PR #62 recon (Node 24 cp probes)]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

`cpSync` fast path (no edge options) → `syncMirror().cpSync` (VFS). Node, before copying, stats both
ends and rejects type mismatches with dedicated codes: file→existing-dir = `ERR_FS_CP_NON_DIR_TO_DIR`,
dir→existing-non-dir = `ERR_FS_CP_DIR_TO_NON_DIR`. rifty surfaces the VFS primitive's `EISDIR`/`EEXIST`
instead (both throw, wrong `.code`). The edge-option path (`cpEntry`) hits the same gap at the leaf
`copyFileSync`/`mkdirSync` calls. PR #62's `errorOnExist` message was fixed; these structural type-mismatch
codes were left (the common case is the pre-existing VFS fast path, a separate boundary).

## Options or Next

Parity-first. Failing parity case for both mismatches (real Node oracle), then add a pre-copy type check
(stat src + dst) in `cpSync`/`cpEntry` throwing the two `ERR_FS_CP_*` codes; consider pushing the check into
the VFS `cpSync` so the fast path is covered too.

## Reversibility

REVERSIBLE — recorded in this backlog item. Error-code-narrowing only; no public-API or dep change.
