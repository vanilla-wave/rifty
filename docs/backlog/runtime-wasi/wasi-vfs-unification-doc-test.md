---
area: runtime-wasi
status: parked
title: M8 — generalize WASI↔main-VFS unification + preopen visibility (tick boxes + real-binary read-through-preopen test)
created: 2026-06-08
why: two M8 acceptance boxes (WASI VFS unified with main VFS; binary sees preopens e.g. /workspace) stay unchecked — proven for esbuild via ADR-0049 but never generalized/asserted as a standalone contract
sources: [PROJECT_PLAN M8 acceptance, ADR-0014, ADR-0049, audit-digest missedLive]
---
## Context
M8 acceptance has two unchecked boxes distinct from the esbuild-specific items already closed by ADR-0049: (1) WASI VFS unified with main VFS as single source of truth; (2) a binary sees its preopens (e.g. `/workspace`). ADR-0014 ratifies one `MemoryBackend` singleton feeding async Vfs + sync FsSync + WASI preopens, and `syncMirror()` is shared with node:fs — so a file written via `fs.writeFileSync` IS visible to a WASI guest and vice versa. The mechanism exists; what's missing is a standalone proof beyond esbuild's own conformance test.
## Options / Next
Ambiguous-verify item: (a) tick the two M8 boxes against the ADR-0014 unified-backend reality once confirmed; (b) add a dedicated test: write a file via node:fs, run a real WASI binary (reuse vendored `@esbuild/wasi-preview1`, or a tiny cat-style guest) that reads it *through a preopen* (e.g. `/workspace`), assert the bytes round-trip both directions. This generalizes the single-source-of-truth claim past the esbuild-transform happy path. Confirm whether ADR-0049's esbuild test already covers read-through-preopen or only stdin/cwd-open.
## Reversibility
Reversible — doc-state tick + one test, no public API / cross-package change. Verify the unified-backend claim before ticking (do not check a box the test doesn't actually prove).
