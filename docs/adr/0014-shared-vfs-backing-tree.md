# ADR 0014: `getFsVfs()` and `syncMirror()` share one backing tree

Status: Implemented (2026-05-24)
Date: 2026-05

## Context

The runtime exposes two parallel filesystem surfaces: the async `Vfs` interface used by `fs.promises` and the sync `FsSync` interface used by `fs.readFileSync` and the WASI preopen layer. Today each is constructed independently — `MemoryVfs` and `MemoryFsSync` are separate objects with separate trees. A file written through `fs.promises.writeFile('/a', 'x')` is invisible to `fs.readFileSync('/a')`, which violates the "one source of truth" claim in M4 and M8 acceptance.

REVIEW_ACTIONS entry A-006 calls this out. A dead `packages/runtime-js/src/builtins/fs-vfs.ts` indirection layer made the gap less obvious by routing async calls through a translation step that no longer matches the sync path.

## Decision

Bind both surfaces to a single backing tree per deployment.

- A `MemoryBackend` object owns the in-memory tree (the `Map<string, FileNode>` structure currently duplicated). It exposes two views: `Vfs` (async) and `FsSync` (sync). `MemoryVfs` and `MemoryFsSync` become thin wrappers reading the same backend.
- In OPFS deployments (ADR 0013), `OpfsVfs` and `OpfsFsSync` both root at the same OPFS directory handle. Writes go through the platform; both surfaces see the same OPFS state.
- The dead `fs-vfs.ts` indirection in `packages/runtime-js/src/builtins/` is removed. `fs.ts` is rewritten so async and sync paths reach the same tree.
- WASI preopens consume the same backend, so files visible to `node:fs` are visible to a WASI-hosted binary.

## Consequences

- `await fs.promises.writeFile('/a', 'x'); fs.readFileSync('/a')` returns `'x'`. M4 and M8 acceptance ("single source of truth") becomes truthful.
- WASI hosts (e.g. `esbuild.wasm` when ADR 0011 lands) observe the same tree as the rest of the runtime.
- Negative: the `Vfs` and `FsSync` interfaces stay separate (different sync/async signatures). Consumers still need to pick the right one for their realm.
- Negative: a refactor of the in-memory tree shape requires updating both view wrappers in lockstep.
- Follow-up: implementation lands in M11 alongside the `OpfsFsSync` work from ADR 0013.

## Acceptance criteria

- [x] Conformance: write via `Vfs.writeFile` is visible through `FsSync.readFileBytesSync` and vice versa (`tests/conformance/builtins/shared-vfs.test.ts`).
- [x] WASI preopen now consumes the same `syncMirror()` instance as `node:fs`, so files visible to either are visible to the WASI host. (Real WASI host program test is gated on vendored `hello.wasm`; the parity is structural — both surfaces go through `MemoryBackend`.)
- [x] `packages/runtime-js/src/builtins/fs-vfs.ts` deleted; no remaining references.
- [x] `createMemoryFs()` returns `{ vfs, fsSync, backend }` paired around a single `MemoryBackend`; `installMemoryFs()` wires both `syncMirror()` and `asyncVfs()` in one call.

## Implementation notes (2026-05-24)

- New `MemoryBackend` (`packages/vfs/src/memory-backend.ts`) owns the in-memory tree synchronously. `MemoryVfs` and `MemoryFsSync` are now ≤ 65-line wrappers over a backend; passing the same backend to both produces a shared view.
- `sync-mirror.ts` gained `asyncVfs()` / `setAsyncVfs()` / `installMemoryFs()` / `createMemoryFs()`. `setSyncMirror(impl)` auto-derives the async view when `impl instanceof MemoryFsSync` so the common path stays one call.
- The dead `fs-vfs.ts` indirection is removed; nothing in the workspace referenced it.
