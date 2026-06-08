---
area: runtime-wasi
status: active
title: WASI syscall decomposition — parity case per syscall family (A-039 ph2 residue)
created: 2026-06-08
why: wasi.ts split into syscalls/{fd,path,proc} shipped, but the "≥1 parity case per syscall family" coverage acceptance (originally a retired process ADR, now this item's content) never landed — coverage is the gap that originally blocked the split
sources: [A-039, TASKS M8, audit-digest VERIFY #0024]
---
## Context
Lexical split `wasi.ts` → `syscalls/{fd,path,proc}.ts` + `shared.ts` DONE (M8, 56 package-level cases). But the open acceptance item — ≥1 *parity* case per syscall family — still UNCHECKED (it was a coverage clause in a now-retired process ADR; that requirement is now THIS item's content). Current coverage = 7 conformance tests (`tests/conformance/wasi/wasi.test.ts`) exercising env/fd/path/proc end-to-end via real `_start` + hand-crafted wasm; per-family parity cases never built. The split was originally deferred to M11 precisely because it lacked coverage to decompose safely — that "why deferred" rationale is now captured here.
## Options / Next
- Add ≥1 parity-runner case per syscall family (args/environ/fd/path/proc/clock/random) — parity = gold standard (CLAUDE.md), but WASI is conformance-shaped (real Node has no preview1 host to diff against), so likely CONFORMANCE not parity. Decide reference: hand-crafted wasm + asserted host-effect vs vendored real binary (esbuild already vendored — reuse).
- Acceptance now lives in this item (the originating process ADR is retired); tracker is this item. Track when next touching the WASI syscall surface.
## Reversibility
Reversible — test-only additions, no public API / cross-package change. Decide the reference shape (parity-vs-conformance) inline via record-and-continue (CLAUDE.md); no decision subagent (does not overturn a recorded decision).
