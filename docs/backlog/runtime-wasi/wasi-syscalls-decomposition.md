---
area: runtime-wasi
status: active
title: WASI syscall decomposition — parity case per syscall family (A-039 ph2 residue)
created: 2026-06-08
why: wasi.ts split into syscalls/{fd,path,proc} shipped, but the ADR-0024 acceptance "≥1 parity case per syscall family" never landed — coverage is the gap that originally blocked the split
sources: [A-039, ADR-0024 (graft into ADR-0033), TASKS M8, audit-digest VERIFY #0024]
---
## Context
Lexical split `wasi.ts` → `syscalls/{fd,path,proc}.ts` + `shared.ts` DONE (M8, 56 package-level cases). But ADR-0024's open acceptance item — ≥1 *parity* case per syscall family — still UNCHECKED. Current coverage = 7 conformance tests (`tests/conformance/wasi/wasi.test.ts`) exercising env/fd/path/proc end-to-end via real `_start` + hand-crafted wasm; per-family parity cases never built. ADR-0024 originally deferred the split to M11 precisely because it lacked coverage to decompose safely — that "why deferred" was lost when ADR-0033 folded the scatter back.
## Options / Next
- Add ≥1 parity-runner case per syscall family (args/environ/fd/path/proc/clock/random) — parity = gold standard (CLAUDE.md), but WASI is conformance-shaped (real Node has no preview1 host to diff against), so likely CONFORMANCE not parity. Decide reference: hand-crafted wasm + asserted host-effect vs vendored real binary (esbuild already vendored — reuse).
- Folded into ADR-0033 graft note; tracker is this item. Track when next touching the WASI syscall surface.
## Reversibility
Reversible — test-only additions, no public API / cross-package change. Decide the reference shape (parity-vs-conformance) inline per ADR-0022; no decision subagent (does not overturn a recorded decision).
