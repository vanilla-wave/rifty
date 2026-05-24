# ADR 0014: `getFsVfs()` and `syncMirror()` share one backing tree

Status: Accepted
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

## Acceptance criteria for the deferred implementation

- [ ] Parity test: `await fs.promises.writeFile('/a', 'x'); const b = fs.readFileSync('/a'); assert b.equals(Buffer.from('x'))`.
- [ ] WASI preopen sees both async-written and sync-written files (test reads a file via a small WASI host program after writing it through `fs.promises`).
- [ ] `packages/runtime-js/src/builtins/fs-vfs.ts` is deleted; no remaining references via `rg "fs-vfs"`.
- [ ] `MemoryVfs` and `MemoryFsSync` constructed from the same `MemoryBackend` share state in both directions (write via either, read via either).
