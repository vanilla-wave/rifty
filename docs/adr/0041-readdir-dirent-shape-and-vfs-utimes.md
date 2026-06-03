# ADR 0041: `FsSync.readdirSync` returns `VfsDirent[]` and `Vfs.utimes` symmetry

Status: Accepted
Date: 2026-05-27

## Context

`@riftydev/vfs` exposes two surfaces over the same backend (ADR-0014, ADR-0037):

- `Vfs` — the async surface (browser / async fixtures).
- `FsSync` — the sync surface (`fs.readFileSync`, WASI preview1 syscalls, the
  shell, the module loader).

The 2026-05-26 architecture audit flagged two asymmetries between them:

1. **Different `readdir` return shapes.**
   - `Vfs.readdir(path): Promise<readonly VfsDirent[]>` — dirent shape, name +
     `isFile` + `isDirectory` per entry.
   - `FsSync.readdirSync(path): readonly string[]` — bare names.
   - Every bridge that adapts between the two pays an N+1 `statSync` per child
     to recover the dirent shape (`apps/playground/src/adapters/sync-mirror-vfs.ts:33`,
     `packages/runtime-js/src/builtins/fs.ts:188` for `withFileTypes: true`).
     The data is already known at the backend level
     (`MemoryBackend.readdirEntries`, `OpfsFsSync.index`) — the interface just
     does not surface it.
   - WASI `fd_readdir` (`packages/runtime-wasi/src/syscalls/fd.ts:289`) always
     writes `FILETYPE_UNKNOWN` for `d_type` because the sync surface does not
     carry the kind. Guests like esbuild re-stat each entry to distinguish
     files from subdirs.
2. **`utimes` only on the sync side.**
   - ADR-0029 ratified `FsSync.utimes(path, atimeMs, mtimeMs)`. The async
     `Vfs` has no symmetric method. `node:fs.utimes`/`fs.promises.utimes` go
     through `FsSync` today, which works, but the async backends carry no
     contract for time-mutation, so a callback-style `fs.utimes` against an
     `OpfsVfs`-only host has no path.

Both gaps surfaced together in the audit (vfs audit F3). Both are
IRREVERSIBLE changes — they edit public exports of `@riftydev/vfs`.

## Decision

`FsSync.readdirSync` returns `readonly VfsDirent[]`. `Vfs` gains
`utimes(path, atimeMs, mtimeMs): Promise<void>`.

- `packages/vfs/src/fs-sync.ts` — `readdirSync` return type widens to
  `readonly VfsDirent[]`.
- `packages/vfs/src/types.ts` — `Vfs.utimes(path, atimeMs, mtimeMs):
  Promise<void>` joins the interface.
- `MemoryFsSync.readdirSync` — routes through
  `MemoryBackend.readdirEntries(path)` (already exists for the async surface).
- `MemoryVfs.utimes` — delegates to `MemoryBackend.utimes`.
- `OpfsFsSync.readdirSync` — walks the in-memory `index` and emits
  `{ name, isFile, isDirectory }` per child from each entry's `kind`.
- `OpfsVfs.utimes` — keeps a private `Map<path, {atime, mtime}>` side-table,
  the same shape `OpfsFsSync` uses. OPFS exposes no native mtime mutation
  on either surface, so both views maintain their own side-table; pairing
  them at the storage layer is left to a future ADR if a real consumer needs
  it.

Caller migration is mechanical: replace `for (const name of entries)` with
`for (const { name } of entries)` (5 sites). The two consumers that *want*
the dirent shape drop their N+1 `statSync` loop entirely:

- `apps/playground/src/adapters/sync-mirror-vfs.ts:33` — `readdir` returns
  the dirents directly.
- `packages/runtime-js/src/builtins/fs.ts:188` — the `withFileTypes: true`
  branch no longer re-stats.

This ADR also unblocks the "fill `d_type` in WASI `fd_readdir`" follow-up
(item 10 in `docs/follow-ups-2026-05-27.md`): with the kind already in the
dirent, `fd_readdir` writes `FILETYPE_REGULAR_FILE` or
`FILETYPE_DIRECTORY` directly.

## Consequences

- Public API change in `@riftydev/vfs`:
  - `FsSync.readdirSync(path)` return type narrows from `readonly string[]`
    to `readonly VfsDirent[]`. Mechanical migration for callers.
  - `Vfs.utimes(path, atimeMs, mtimeMs)` is now part of the contract.
    Existing `Vfs` implementations (`MemoryVfs`, `OpfsVfs`, `SyncMirrorVfs`)
    each implement it. Third-party `Vfs` adapters get a compile error
    until they add the method — caught by `tsc`, no silent shape drift.
- ADR-0029 is reinforced, not contradicted — async-side `utimes` is the
  symmetric extension it foreshadowed.
- One source of truth per concept across the two surfaces. The asymmetries
  that forced N+1 stat in every bridge are now design-level eliminated.
- OpfsVfs ↔ OpfsFsSync mtime drift is documented as out-of-scope: each
  surface tracks its own side-table. Callers that need cross-surface time
  coherence should drive both via the same code path (e.g. only ever
  through `node:fs` which routes to `FsSync`).

## References

- ADR-0014 — shared VFS backing tree.
- ADR-0029 — `FsSync.utimes` (the sync half this completes).
- ADR-0037 — unified sync VFS contract.
- 2026-05-26 architecture audit, vfs F3 finding.
- `docs/follow-ups-2026-05-27.md` items #2 and #10.
