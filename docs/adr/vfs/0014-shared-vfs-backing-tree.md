# ADR 0014: `getFsVfs()` and `syncMirror()` share one backing tree

Status: Implemented (2026-05-24)
Date: 2026-05

**Decision (2026-05-26):** Full landing targeted for **M11 (end of June 2026)**. A process-wide `MemoryBackend` singleton owns the in-memory tree; `MemoryVfs` (async) and `MemoryFsSync` (sync) are thin wrappers resolving every read/write through it. The OPFS pair (`OpfsVfs` + `OpfsFsSync`) shares one OPFS directory handle plus an in-memory `Map<string, FileSystemSyncAccessHandle>`, so neither surface reopens the same node twice. WASI preopens consume the same backend — files visible to `node:fs` are visible to a WASI-hosted binary. `installMemoryFs()` / `installOpfsFs()` are the only sites that mint a backend; everything else picks it up via `getFsVfs()` / `syncMirror()`.

## Context

The runtime exposes two parallel filesystem surfaces: async `Vfs` (`fs.promises`) and sync `FsSync` (`fs.readFileSync` + WASI preopen layer). Today each is built independently with separate trees, so a file written via `fs.promises.writeFile('/a', 'x')` is invisible to `fs.readFileSync('/a')` — violating the "one source of truth" claim in M4/M8 acceptance.

REVIEW_ACTIONS entry A-006 flags this. A dead `packages/runtime-js/src/builtins/fs-vfs.ts` indirection layer obscured the gap by routing async calls through a translation step no longer matching the sync path.

## Decision

Bind both surfaces to a single backing tree per deployment.

- A `MemoryBackend` owns the in-memory tree (the currently-duplicated `Map<string, FileNode>`) and exposes both views: `Vfs` (async) and `FsSync` (sync). `MemoryVfs` / `MemoryFsSync` become thin wrappers over the same backend.
- OPFS deployments (ADR 0013): `OpfsVfs` and `OpfsFsSync` both root at the same OPFS directory handle; writes go through the platform, so both surfaces see the same state.
- The dead `fs-vfs.ts` indirection in `packages/runtime-js/src/builtins/` is removed; `fs.ts` is rewritten so async and sync paths reach the same tree.
- WASI preopens consume the same backend, so `node:fs`-visible files are visible to a WASI-hosted binary.

## Consequences

- `await fs.promises.writeFile('/a', 'x'); fs.readFileSync('/a')` returns `'x'` — M4/M8 "single source of truth" becomes truthful.
- WASI hosts (e.g. `esbuild.wasm` when ADR 0011 lands) observe the same tree as the rest of the runtime.
- Negative: `Vfs` and `FsSync` stay separate interfaces (different sync/async signatures); consumers still pick the right one per realm.
- Negative: refactoring the in-memory tree shape requires updating both view wrappers in lockstep.
- Follow-up: implementation lands in M11 alongside `OpfsFsSync` from ADR 0013.

## Acceptance criteria

- [x] Conformance: write via `Vfs.writeFile` is visible through `FsSync.readFileBytesSync` and vice versa (`tests/conformance/builtins/shared-vfs.test.ts`).
- [x] WASI preopen consumes the same `syncMirror()` instance as `node:fs`. (Real WASI host program test is gated on vendored `hello.wasm`; parity is structural — both surfaces go through `MemoryBackend`.)
- [x] `packages/runtime-js/src/builtins/fs-vfs.ts` deleted; no remaining references.
- [x] `createMemoryFs()` returns `{ vfs, fsSync, backend }` around a single `MemoryBackend`; `installMemoryFs()` wires both `syncMirror()` and `asyncVfs()` in one call.

## Implementation notes (2026-05-24)

- New `MemoryBackend` (`packages/vfs/src/memory-backend.ts`) owns the in-memory tree synchronously. `MemoryVfs` / `MemoryFsSync` are now ≤ 65-line wrappers; passing the same backend to both produces a shared view.
- `sync-mirror.ts` gained `asyncVfs()` / `setAsyncVfs()` / `installMemoryFs()` / `createMemoryFs()`. `setSyncMirror(impl)` auto-derives the async view when `impl instanceof MemoryFsSync`, keeping the common path one call.
- The dead `fs-vfs.ts` indirection is removed; nothing referenced it.
