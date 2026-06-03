# @riftydev/vfs

Virtual filesystem interface + backends. Pure TypeScript, no framework deps.

## Backends

- **Memory** (`MemoryVfs`) — in-memory, for tests and dev (current).
- **OPFS** (`OpfsVfs`) — Origin Private File System, sync API via `FileSystemSyncAccessHandle` inside Workers (M4, TBD).

## Public API

See `src/types.ts`. Importable only via `@riftydev/vfs` (the package root); internals under `src/internal/` are private.
