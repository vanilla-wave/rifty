---
area: runtime-js
status: active
title: Restore true async streaming in createReadStream (fix OpfsVfs.openReadable under cross-realm serving)
created: 2026-06-15
why: ADR-0148 P5 made createReadStream prefer the sync content cache because OpfsVfs.openReadable's File.stream() stalls under cross-realm preview serving; the ADR-0020 phase-2 streaming path is now fallback-only
user_story: As a dev serving a large static file (express.static) from an OPFS-backed owner, I want createReadStream to stream incrementally from disk (ADR-0020 phase 2) rather than load the whole file from the in-memory content cache — once the OPFS async-stream stall is fixed.
sources: [ADR-0148, ADR-0020, ADR-0072]
---
## Context
P5 (ADR-0148) wired OPFS into the workspace owner. The owner then serves static files through `express.static` → serve-static → `send` → `fs.createReadStream` → `asyncVfs().openReadable` = `OpfsVfs.openReadable` → `File.slice().stream()`. Under cross-realm preview serving (SW → page bridge → owner `serveCrossRealmPreview` → express) that stream **stalls** — the file exists on OPFS disk and `openReadable` resolves, but the consumed stream never delivers, so express never responds and the preview bridge returns **502** (regression caught by `tests/e2e/fullstack-demo.spec.ts`: `/api/todos` 200 but `/` 502).

Fix shipped in P5: `fs-streams.ts createReadStream` now PREFERS the sync mirror (`readFileBytesSync` — the OPFS content cache, ADR-0072, authoritative + fully in-memory via preload), using `openReadable` only when the sync view lacks the path. No streaming benefit is lost today (the cache already holds the whole file), but the ADR-0020 phase-2 incremental-streaming path is now reached only for async-only writes. Marker: `// TODO(backlog: runtime-js/createreadstream-true-async-streaming)`.

## Options / Next
Root-cause why `File.stream()` (or its `getReader().read()` loop) stalls in the owner Worker during cross-realm serving — candidates: concurrent OPFS access (OpfsFsSync write-through to the same dir) invalidating the held `File`; the cross-realm body serialization not draining a streaming `ReadableStream`; a Worker `File.stream()` quirk. Likely fix: make `OpfsVfs.openReadable` read via `getFile()` + `arrayBuffer()` into a single-chunk stream (no `File.stream()`), or fix the cross-realm preview body to drain streaming bodies. Then re-enable `openReadable`-first in `createReadStream` and drop the prefer-sync short-circuit. Regression guard: `fullstack-demo` `/` route + `fs.test.ts` createReadStream-prefers-sync-mirror case.

## Reversibility
REVERSIBLE — internal runtime read path; no public-API change. The prefer-sync short-circuit can be lifted once the async stream is fixed. Backed by ADR-0072 (sync content cache authoritative) + ADR-0020 (streaming goal retained as the target end state).
