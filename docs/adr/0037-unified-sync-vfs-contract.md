# ADR 0037: Unified sync VFS contract

Status: Accepted
Date: 2026-05

## Context

`@riftydev/vfs` already owns a single sync-side interface — `FsSync`
(`packages/vfs/src/fs-sync.ts`) — implemented by `MemoryFsSync` and
`OpfsFsSync`. The module loader in `@riftydev/runtime-js`, however, defines
its **own** parallel sync interface `SyncVfs`
(`packages/runtime-js/src/module-loader/vfs-sync.ts`) and a hand-rolled
backend `MemorySyncVfs`
(`packages/runtime-js/src/module-loader/memory-sync-vfs.ts`). The two
contracts have drifted:

- `SyncVfs.readFileSync(path): string` — bytes-shaped surface absent;
  loader always decodes to UTF-8 inside the backend.
- No `mkdir` / `rm` / `writeFile` / `utimes` on `SyncVfs`.
- `MemorySyncVfs` keeps its own `Map<string, string>` tree, completely
  unrelated to `MemoryBackend`.

The practical result: `worker-entry.ts` instantiates a `MemorySyncVfs`
**and** uses `syncMirror()` (a `MemoryFsSync` over `MemoryBackend`).
The module loader sees a different filesystem from `node:fs` inside the
Worker. The 2026-05-26 architecture audit flagged this as P0 because it
silently violates ADR-0014's "shared backing tree" promise: a file
loaded as fixture (`load-fixture` message) lands in `MemorySyncVfs`'s
internal map but is invisible to `fs.readFileSync` (which goes through
`syncMirror()` / `MemoryBackend`).

## Decision

Drop the parallel `SyncVfs` / `MemorySyncVfs` pair. The module loader
(resolver + linker + executor) consumes `@riftydev/vfs:FsSync` directly.

- `packages/runtime-js/src/module-loader/vfs-sync.ts` is **deleted**.
- `packages/runtime-js/src/module-loader/memory-sync-vfs.ts` is
  **deleted**.
- `createModuleLoader(fsSync, opts)` and `createResolver(fsSync)` take
  an `FsSync` (re-exported as the loader's sole sync surface).
- `readFileSync` (string) call sites use `readFileBytesSync` plus a
  single `TextDecoder('utf-8').decode(...)` inline at the point of use
  (resolver's `readPackageJson` and `readResolved` — only two sites; no
  helper introduced).
- `worker-entry.ts` constructs a single `MemoryFsSync` (via
  `createMemoryFs()`'s `fsSync`), wires it into `setSyncMirror(...)`,
  and passes the same instance to `createModuleLoader`. After this,
  `load-fixture` writes flow into `MemoryBackend` through `loadFixture`
  on `MemoryFsSync` — the very same tree that `node:fs` and the WASI
  preopens consume.
- Subpath exports change: `@riftydev/runtime-js/loader` no longer exports
  `MemorySyncVfs` or `SyncVfs`. Callers (tests, parity runner,
  playground adapter) construct a `MemoryFsSync` from `@riftydev/vfs` (or
  pass any `FsSync`) and feed it to the loader.

`createReadOnlyView` was considered as an explicit narrowing helper for
the loader. Rejected — the loader genuinely only reads (resolver,
package.json parsing, source reads) but the cost of a wrapper layer
outweighs the value when the existing interface already covers reads
cleanly. Should a downstream caller want a hardened read-only view
later, it can be added without breaking this ADR's surface.

## Consequences

- ADR-0014's "shared backing tree" is now actually achieved inside the
  Worker realm: `load-fixture`, `fs.readFileSync`, WASI preopens, and
  module resolution all consult one `MemoryBackend`.
- Public-API change for `@riftydev/runtime-js`:
  - `MemorySyncVfs` removed from `./loader` subpath.
  - `SyncVfs` type removed from `./loader` subpath.
  - `createModuleLoader` and `createResolver` now take `FsSync` from
    `@riftydev/vfs`. The argument shape narrows — callers passing a
    custom adapter must implement `readFileBytesSync` instead of
    `readFileSync(): string` and add the missing methods
    (`writeFileSync`, `mkdirSync`, `rmSync`, `utimes`).
- The playground's `realVite.ts` adapter had a hand-rolled
  `makeSyncVfs()` mapping `syncMirror()` to the old `SyncVfs` shape.
  That helper is gone; we pass `syncMirror()` (an `FsSync`) directly.
- One source of truth for the sync interface — future evolutions
  (`renameSync`, `copyFileSync`, etc.) land in `FsSync` only.
- `MemoryFsSync.loadFixture` already exists in `@riftydev/vfs`
  (`sync-mirror.ts:64`), so the worker-entry fixture path stays
  one-liner: `fs.loadFixture(msg.files)`.

## References

- ADR-0014 — shared VFS backing tree (the promise this ADR finally
  redeems for the Worker realm).
- ADR-0029 — `FsSync.utimes` on the interface; the unified surface
  carries `utimes` end-to-end.
- 2026-05-26 architecture audit — P0 "parallel SyncVfs hierarchy".
