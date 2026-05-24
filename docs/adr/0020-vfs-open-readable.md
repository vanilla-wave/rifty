# ADR 0020: `Vfs.openReadable()` for true `createReadStream`

Status: Phase 1 implemented (2026-05-24) — `Vfs.openReadable` interface + `MemoryVfs` impl + stubs in `OpfsVfs` and `SyncMirrorVfs`. Phase 2 (real `OpfsVfs.openReadable` + `createReadStream` rewrite) deferred to M11, blocked on ADR 0014.
Date: 2026-05

## Context

`fs.createReadStream(path)` currently reads the whole file into memory and emits it as a single `data` chunk. For large files this defeats the purpose of the streaming API and risks OOM. The `Vfs` interface exposes only `readFile(path): Promise<Uint8Array>`, so `createReadStream` has no streaming primitive to build on.

REVIEW_ACTIONS entry A-020 flags it. Real backpressure also matters for piping into HTTP responses and for the streaming rewrite envisioned by ADR 0017.

## Decision

Extend the `Vfs` interface with `openReadable(path, opts?): Promise<ReadableStream<Uint8Array>>` and rewrite `createReadStream` on top of it.

- New method: `openReadable(path, opts?: { start?: number; end?: number; chunkSize?: number }): Promise<ReadableStream<Uint8Array>>`.
- `MemoryVfs` implements as a chunked iterator over the stored bytes (default `chunkSize` 64 KiB).
- `OpfsVfs` returns `(await fileHandle.getFile()).stream()`, optionally `.slice(start, end)` first when offsets are provided.
- `createReadStream` consumes `openReadable` and exposes a Node `Readable` honoring backpressure (the underlying `ReadableStream`'s lock counts as the backpressure signal).
- Implementation deferred to M11. The change to the `Vfs` interface is cross-package public API (ADR 0012-style ripple), so it pairs with the broader I/O layer move.

## Consequences

- Big-file reads stop OOMing; piping a file to an HTTP response becomes viable.
- Backpressure semantics in the Node `Readable` adapter match user expectations from real Node.
- Negative: `Vfs` interface change ripples through every implementation (`MemoryVfs`, `OpfsVfs`, any test fakes). Adopters in the repo update in lockstep.
- Negative: `OpfsVfs.openReadable` depends on `File.stream()` availability, which is well supported but adds a feature-detect branch for older Safari builds.
- Follow-up: M11.

## Acceptance criteria for the deferred implementation

- [ ] `Vfs.openReadable` exists in `packages/vfs/src/types.ts` and is implemented by `MemoryVfs` and `OpfsVfs`.
- [ ] `createReadStream` on a 50 MiB file streams in ≤ 64 KiB chunks without buffering the whole file (peak heap delta measured).
- [ ] `createReadStream(...).pipe(createWriteStream(...))` respects backpressure: the writer's `drain` event gates further reads.
- [ ] Existing `createReadStream` consumers continue to pass current tests.
