# ADR 0037: Unified sync VFS contract

Status: Accepted
Date: 2026-05

> TL;DR: Module loader drops its parallel `SyncVfs`/`MemorySyncVfs` and consumes `@riftydev/vfs:FsSync` directly, so loader, `node:fs`, and WASI share one `MemoryBackend`

## Context

`@riftydev/vfs` owns one sync interface, `FsSync` (`packages/vfs/src/fs-sync.ts`), implemented by `MemoryFsSync` and `OpfsFsSync`. But the `@riftydev/runtime-js` module loader defines a **parallel** `SyncVfs` (`packages/runtime-js/src/module-loader/vfs-sync.ts`) with its own backend `MemorySyncVfs` (`packages/runtime-js/src/module-loader/memory-sync-vfs.ts`). They drifted:

- `SyncVfs.readFileSync(path): string` — no bytes surface; backend always UTF-8 decodes.
- No `mkdir` / `rm` / `writeFile` / `utimes` on `SyncVfs`.
- `MemorySyncVfs` keeps its own `Map<string, string>` tree, unrelated to `MemoryBackend`.

Result: `worker-entry.ts` runs both a `MemorySyncVfs` and `syncMirror()` (a `MemoryFsSync` over `MemoryBackend`), so the loader sees a different filesystem from `node:fs`. A `load-fixture` file lands in `MemorySyncVfs`'s map but is invisible to `fs.readFileSync` (which goes via `syncMirror()` / `MemoryBackend`). The 2026-05-26 architecture audit flagged this P0: it silently violates ADR-0014's "shared backing tree".

## Decision

Drop the `SyncVfs` / `MemorySyncVfs` pair; the module loader (resolver + linker + executor) consumes `@riftydev/vfs:FsSync` directly.

- **Delete** `packages/runtime-js/src/module-loader/vfs-sync.ts` and `memory-sync-vfs.ts`.
- `createModuleLoader(fsSync, opts)` and `createResolver(fsSync)` take an `FsSync` (re-exported as the loader's sole sync surface).
- Former `readFileSync` (string) sites use `readFileBytesSync` + an inline `TextDecoder('utf-8').decode(...)` — only two sites (resolver's `readPackageJson` and `readResolved`); no helper introduced.
- `worker-entry.ts` builds one `MemoryFsSync` (via `createMemoryFs()`'s `fsSync`), wires it into `setSyncMirror(...)`, and passes the same instance to `createModuleLoader`. Then `load-fixture` flows through `loadFixture` on `MemoryFsSync` into `MemoryBackend` — the same tree `node:fs` and WASI preopens consume.
- Subpath `@riftydev/runtime-js/loader` no longer exports `MemorySyncVfs` or `SyncVfs`. Callers (tests, parity runner, playground adapter) construct a `MemoryFsSync` from `@riftydev/vfs` (or pass any `FsSync`).

`createReadOnlyView` was considered as an explicit narrowing helper. **Rejected** — the loader is read-only, but a wrapper layer's cost outweighs the value when `FsSync` already covers reads cleanly; a hardened read-only view can be added later without breaking this surface.

## Consequences

- ADR-0014's "shared backing tree" is now actually achieved in the Worker: `load-fixture`, `fs.readFileSync`, WASI preopens, and module resolution all consult one `MemoryBackend`.
- Public-API change for `@riftydev/runtime-js`:
  - `MemorySyncVfs` and `SyncVfs` removed from `./loader`.
  - `createModuleLoader` / `createResolver` now take `FsSync` from `@riftydev/vfs`. Custom adapters must implement `readFileBytesSync` (not `readFileSync(): string`) plus `writeFileSync`, `mkdirSync`, `rmSync`, `utimes`.
- The playground's `realVite.ts` hand-rolled `makeSyncVfs()` (mapping `syncMirror()` to the old `SyncVfs` shape) is gone; pass `syncMirror()` (an `FsSync`) directly.
- One source of truth — future additions (`renameSync`, `copyFileSync`, etc.) land in `FsSync` only.
- `MemoryFsSync.loadFixture` already exists in `@riftydev/vfs` (`sync-mirror.ts:64`), so the worker-entry fixture path stays one line: `fs.loadFixture(msg.files)`.

## References

- ADR-0014 — shared VFS backing tree (the promise this redeems for the Worker realm).
- ADR-0029 — `FsSync.utimes`; the unified surface carries `utimes` end-to-end.
- 2026-05-26 architecture audit — P0 "parallel SyncVfs hierarchy".
