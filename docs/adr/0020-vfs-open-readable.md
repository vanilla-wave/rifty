# ADR 0020: `Vfs.openReadable()` for true `createReadStream`

Status: Phase 1 Implemented (2026-05-24). Phase 2 deferred to **post-A-006** (after ADR-0014 shared backing tree lands in M11).
Date: 2026-05

**Decision (2026-05-26):** Phase 2 (`OpfsVfs.openReadable` real implementation wrapping `File.stream()` with optional `slice` for byte ranges, plus rewriting `createReadStream` on top of `asyncVfs().openReadable(...)`) is **gated on ADR-0014 (shared VFS backing tree) landing first**. Reason: until both `Vfs` and `FsSync` views point at the same backend, an `OpfsVfs.openReadable` that returns a `ReadableStream` from one tree while `createReadStream`'s fallback path uses the other tree would manifest as a "single source of truth" violation in `M4`/`M8` acceptance. Order: ADR-0014 first → then ADR-0020 phase 2. Both land in M11.

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

## Acceptance criteria

- [x] `Vfs.openReadable` exists in `packages/vfs/src/types.ts` and is implemented by `MemoryVfs` and `OpfsVfs`.
- [x] `createReadStream` on a 256 KiB file streams in 64 KiB chunks — conformance asserts ≥ 4 `data` events.
- [x] `createReadStream(...).pipe(createWriteStream(...))` works (existing fs-streams conformance still passes).
- [x] Existing `createReadStream` consumers continue to pass current tests.

## Follow-ups

- Heap-delta benchmark on a 50 MiB file (memory tracking is environment-specific; the structural test above is what blocks regressions today).
- True backpressure via the writable side's drain event — currently the reader pulls eagerly. A follow-up wraps the read loop in `await writer.ready` for full pause/resume semantics.
