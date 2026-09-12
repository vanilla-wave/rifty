# @riftydev/vfs

Virtual filesystem interface + backends. Pure TypeScript, no framework deps.

## Backends

- **Memory** (`MemoryVfs`) — in-memory, for tests and dev (current).
- **OPFS** (`OpfsVfs`) — Origin Private File System, sync API via `FileSystemSyncAccessHandle` inside Workers (M4, TBD).

## Public API

See `src/types.ts`. Importable only via `@riftydev/vfs` (the package root); internals under `src/internal/` are private.

## Replica backend controls

Workbench/configured SDK storage uses the segment replica (ADR-0425). Its
paired async writes already enter the sync owner. Native per-file controls
`OpfsFsSync.openSync`, `refreshIndex` and `preloadContent` are unavailable in
replica mode and throw named NotImplementedError; ordinary FsSync/Node file
operations remain supported. The default standalone per-file mode retains them.

| backend control | per-file | replica |
|---|---|---|
| native prewarm / external per-file refresh | ✅ | ❌ — no external per-file substrate |
