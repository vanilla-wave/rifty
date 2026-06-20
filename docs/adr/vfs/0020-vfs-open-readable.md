# ADR 0020: `Vfs.openReadable()` for true `createReadStream`

Status: Phase 1 Implemented (2026-05-24). Phase 2 deferred to **post-A-006** (after ADR-0014 shared backing tree lands in M11).
Date: 2026-05

**Corrected (2026-06-20):** Phase 2 has LANDED — ADR-0014 (shared backing tree) is `Implemented`, `Vfs.openReadable` is implemented by `MemoryVfs`/`OpfsVfs`, and `createReadStream` is async-first over `asyncVfs().openReadable(...)` (Acceptance criteria below all ✅); the "Phase 2 deferred … M11" status line is superseded. MECHANISM CORRECTION: `OpfsVfs.openReadable` does NOT use `File.stream()` (nor a Safari feature-detect — supersedes the lines 6/8/20/29 wording). It pulls a chunked `ReadableStream` via `File.slice(offset, next).arrayBuffer()` (PR #56), which honors `chunkSize` and avoids the `File.stream()` stall under cross-realm Worker serving. `createReadStream`'s Node-inclusive `end` is converted to the half-open `[start, end)` `openReadable` window at the runtime-js boundary.

**Decision (2026-05-26):** Phase 2 (real `OpfsVfs.openReadable` wrapping `File.stream()` with optional `slice` for byte ranges; rewrite `createReadStream` on `asyncVfs().openReadable(...)`) is **gated on ADR-0014 (shared VFS backing tree) landing first**. Until `Vfs` and `FsSync` views share one backend, `openReadable` streaming from one tree while `createReadStream`'s fallback uses another would surface as a "single source of truth" violation in M4/M8 acceptance. Order: ADR-0014 → ADR-0020 phase 2; both land in M11.

> TL;DR: `Vfs.openReadable(path, opts?)` returns a `ReadableStream<Uint8Array>` (64 KiB chunks / `File.stream()`+`slice`); `createReadStream` rebuilds on it for true backpressured streaming

## Context

`fs.createReadStream(path)` reads the whole file into memory and emits one `data` chunk — defeats streaming and risks OOM on large files. `Vfs` exposes only `readFile(path): Promise<Uint8Array>`, so there's no streaming primitive to build on. Flagged by REVIEW_ACTIONS A-020. Backpressure also matters for piping into HTTP responses and the streaming rewrite of ADR-0017.

## Decision

Extend `Vfs` with `openReadable(path, opts?): Promise<ReadableStream<Uint8Array>>` and rewrite `createReadStream` on top of it.

- New method: `openReadable(path, opts?: { start?: number; end?: number; chunkSize?: number }): Promise<ReadableStream<Uint8Array>>`.
- `MemoryVfs`: chunked iterator over stored bytes (default `chunkSize` 64 KiB).
- `OpfsVfs`: returns `(await fileHandle.getFile()).stream()`, `.slice(start, end)` first when offsets given.
- `createReadStream`: consumes `openReadable`, exposes a Node `Readable` honoring backpressure (the `ReadableStream` lock is the backpressure signal).
- Implementation deferred to M11 — the `Vfs` interface change is cross-package public API (ADR-0012-style ripple), so it pairs with the broader I/O layer move.

## Consequences

- Big-file reads stop OOMing; piping a file to an HTTP response becomes viable.
- Node `Readable` adapter backpressure matches real Node.
- Negative: interface change ripples through every `Vfs` impl (`MemoryVfs`, `OpfsVfs`, test fakes) — adopters update in lockstep.
- Negative: `OpfsVfs.openReadable` depends on `File.stream()`, requiring a feature-detect branch for older Safari.
- Follow-up: M11.

## Acceptance criteria

- [x] `Vfs.openReadable` exists in `packages/vfs/src/types.ts`, implemented by `MemoryVfs` and `OpfsVfs`.
- [x] `createReadStream` on a 256 KiB file streams in 64 KiB chunks — conformance asserts ≥ 4 `data` events.
- [x] `createReadStream(...).pipe(createWriteStream(...))` works (fs-streams conformance still passes).
- [x] Existing `createReadStream` consumers still pass.

## Follow-ups

- Heap-delta benchmark on a 50 MiB file (memory tracking is env-specific; the structural test above blocks regressions today).
- True backpressure via the writable side's drain event — reader currently pulls eagerly; follow-up wraps the read loop in `await writer.ready` for full pause/resume.
