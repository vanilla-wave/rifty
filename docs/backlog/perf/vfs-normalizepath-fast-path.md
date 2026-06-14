---
area: perf
subsystem: vfs
status: active
title: ADR-0084 — normalizePath already-normalized fast-path + normalized-string path helpers in @riftydev/vfs
created: 2026-06-08
why: dirname/basename/extname/segments re-run full normalizePath on already-normalized strings (OPFS write 3x, MemoryBackend ~5x/syscall); chokepoint on every fs syscall + resolver probe
user_story: As a dev doing heavy file I/O, I want each `fs` syscall to not re-normalize an already-normalized path, but today `dirname`/`basename`/`extname`/`segments` re-run full `normalizePath` (~5x/syscall on MemoryBackend, 3x/OPFS write) since the already-normalized fast-path is unimplemented.
sources: [perf-audit #10, adr-plan A/ADR-0084, ADR-0037 (preserve invariant, not supersede)]
---
## Context
path.ts:44-80: dirname/basename/extname/segments re-run full normalizePath. Governs body of exported `normalizePath` + new internal dirnameNormalized/basenameNormalized, threaded into hot callers (opfs-sync, memory backend). rule4 (multi-file thread-through; byte-identical but blast-radius = every fs syscall + resolver probe).
## Options / Next
(1) internal dirnameNormalized/basenameNormalized doing only `lastIndexOf('/')` slicing for known-normalized callers; (2) already-normalized early-return inside normalizePath (leading `/`, no `//`, no trailing `/`, no `./`/`../` or `/.`/`/..` endings). New helpers stay internal (exporting flips to rule1). Gate with predicate-targeted unit tests incl. `/a/..`, `/a/.`, `/a//b`, relative, empty, filenames-with-dots.
## Reversibility
IRREVERSIBLE — rule4 multi-file thread-through. Preserves ADR-0037 normalisation invariant (not a supersede). No decision subagent.
