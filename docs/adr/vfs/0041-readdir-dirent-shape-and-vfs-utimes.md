# ADR 0041: `FsSync.readdirSync` returns `VfsDirent[]` and `Vfs.utimes` symmetry

Status: Accepted
Date: 2026-05-27

> TL;DR: `FsSync.readdirSync` returns `readonly VfsDirent[]` (kills N+1 `statSync`) and async `Vfs` gains symmetric `utimes`

## Context

`@riftydev/vfs` exposes two surfaces over one backend (ADR-0014, ADR-0037): `Vfs` (async — browser/async fixtures) and `FsSync` (sync — `fs.readFileSync`, WASI preview1 syscalls, shell, module loader). The 2026-05-26 audit (vfs F3) flagged two asymmetries:

1. **`readdir` return shape mismatch.**
   - `Vfs.readdir(path): Promise<readonly VfsDirent[]>` — name + `isFile` + `isDirectory` per entry.
   - `FsSync.readdirSync(path): readonly string[]` — bare names.
   - Bridges pay an N+1 `statSync` per child to recover the dirent shape (`apps/playground/src/adapters/sync-mirror-vfs.ts:33`, `packages/runtime-js/src/builtins/fs.ts:188` for `withFileTypes: true`), even though the backend already knows it (`MemoryBackend.readdirEntries`, `OpfsFsSync.index`).
   - WASI `fd_readdir` (`packages/runtime-wasi/src/syscalls/fd.ts:289`) always writes `FILETYPE_UNKNOWN` for `d_type` because the sync surface drops the kind; guests like esbuild re-stat each entry.

2. **`utimes` only on the sync side.** ADR-0029 ratified `FsSync.utimes(path, atimeMs, mtimeMs)`; async `Vfs` has no symmetric method. `node:fs.utimes` works today via `FsSync`, but an `OpfsVfs`-only host has no callback-style path.

Both edit public exports of `@riftydev/vfs` → IRREVERSIBLE.

## Decision

`FsSync.readdirSync` returns `readonly VfsDirent[]`. `Vfs` gains `utimes(path, atimeMs, mtimeMs): Promise<void>`.

- `packages/vfs/src/fs-sync.ts` — `readdirSync` return type → `readonly VfsDirent[]`.
- `packages/vfs/src/types.ts` — adds `Vfs.utimes(path, atimeMs, mtimeMs): Promise<void>`.
- `MemoryFsSync.readdirSync` — routes through existing `MemoryBackend.readdirEntries(path)`.
- `MemoryVfs.utimes` — delegates to `MemoryBackend.utimes`.
- `OpfsFsSync.readdirSync` — walks in-memory `index`, emits `{ name, isFile, isDirectory }` from each child's `kind`.
- `OpfsVfs.utimes` — keeps a private `Map<path, {atime, mtime}>` side-table (same shape as `OpfsFsSync`). OPFS has no native mtime mutation, so each view keeps its own side-table; pairing them at the storage layer is deferred to a future ADR if a real consumer needs it.

Caller migration is mechanical: `for (const name of entries)` → `for (const { name } of entries)` (5 sites). The two dirent-wanting consumers drop their N+1 `statSync` loop:

- `apps/playground/src/adapters/sync-mirror-vfs.ts:33` — `readdir` returns dirents directly.
- `packages/runtime-js/src/builtins/fs.ts:188` — `withFileTypes: true` branch no longer re-stats.

This unblocks the "fill `d_type` in WASI `fd_readdir`" follow-up (item 10 in `docs/follow-ups-2026-05-27.md`): with the kind in the dirent, `fd_readdir` writes `FILETYPE_REGULAR_FILE` / `FILETYPE_DIRECTORY` directly.

## Consequences

- Public API change in `@riftydev/vfs`:
  - `FsSync.readdirSync(path)` narrows `readonly string[]` → `readonly VfsDirent[]`; mechanical caller migration.
  - `Vfs.utimes(path, atimeMs, mtimeMs)` joins the contract. `MemoryVfs`, `OpfsVfs`, `SyncMirrorVfs` each implement it; third-party `Vfs` adapters get a `tsc` compile error until they add it — no silent shape drift.
- ADR-0029 reinforced, not contradicted — this is the symmetric async-side extension it foreshadowed.
- One source of truth per concept across both surfaces; the asymmetries that forced N+1 stat in every bridge are eliminated at the design level.
- OpfsVfs ↔ OpfsFsSync mtime drift is out-of-scope: each surface tracks its own side-table. Callers needing cross-surface time coherence should drive both via one code path (e.g. only via `node:fs`, which routes to `FsSync`).

## References

- ADR-0014 — shared VFS backing tree.
- ADR-0029 — `FsSync.utimes` (the sync half this completes).
- ADR-0037 — unified sync VFS contract.
- 2026-05-26 architecture audit, vfs F3 finding.
- `docs/follow-ups-2026-05-27.md` items #2 and #10.
