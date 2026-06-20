---
area: runtime-js
status: parked
title: node:fs/node:path pure-JS surface completions
created: 2026-06-20
why: Batch of node:fs/path methods absent — all pure-JS over existing VFS sync primitives (or POSIX/no-symlink identity); tree-walkers + copy helpers TypeError today.
user_story: As a dev running a bundler/build tool, I want recursive readdir + Dirent.parentPath + cp filter/force opts, but today they're undefined so the tool throws walking my tree.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §1, ADR-0050 (no-symlink), ADR-0026]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/path.ts, packages/vfs/src/fs-sync.ts]
---

## Context

VFS exposes the sync primitives every item needs (`readdirSync`/`utimes`/`cpSync`, `fs-sync.ts:27/48/67`). Gaps are pure-JS composition or POSIX/no-symlink identity. Each: node-API (+since) · real-path · anchor.

| feature | since | real-path · anchor |
|---|---|---|
| `readdirSync({recursive})` + `Dirent.parentPath` (couple) | v18.17 / v20.1 | DFS join over per-dir `vfs.readdirSync`; set parentPath field at `Dirent` ctor (`fs.ts:520`, `:189`) |
| `fs.glob`/`globSync`/`promises.glob` + `path.matchesGlob` | v22 / v22.5 | pure-JS segment matcher (`*`/`**`/`?`/`[..]`) over recursive walk; shared with shell/glob-expansion (`path.ts:108`) — phase-2, L, fidelity-med |
| `openAsBlob` | v19.8 | read VFS bytes → `new Blob([bytes],{type})`, resolved Promise |
| `cp`/`cpSync` edge-opts `{filter,force,errorOnExist,preserveTimestamps}` | v16.7 | gate/existsSync/utimes in runtime-js over existing `cpSync` (`fs.ts:631`); `dereference` → `NotImplementedError` (N/A under ADR-0050, not a ceiling) |
| `toNamespacedPath`/`posix.` | v9 | POSIX identity no-op = faithful (win32 namespacing only non-identity; `win32===posix`, `path.ts:124`) |
| `lutimes`/`lutimesSync`/`promises.lutimes` | v14.5 | identical to utimes under no-symlink (precedent `lstat===stat`, `fs.ts:580`) |
| `futimes`/`futimesSync` | v0.4 | `fdTable`/`getFd` resolve fd→path (`fs.ts:110/396`); delegate to `utimesSync`; `EBADF` on unknown fd |

## Options or Next

Parity-first, per-feature promotable. Per item: failing parity test (real Node oracle) → implement. Order by impact: recursive-readdir+parentPath pair (S) → cp edge-opts (M) → openAsBlob/toNamespacedPath/lutimes/futimes (S each) → glob family last (L, fidelity-med, blocks on shared matcher with shell/glob-expansion; throw on unsupported brace/extglob/negation edges).

## Reversibility

REVERSIBLE — recorded here. Each method additive over existing VFS; `cp.dereference` NotImplementedError + glob unsupported-edge throws keep gaps loud (no silent stubs).
