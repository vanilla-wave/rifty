---
area: runtime-wasi
status: parked
title: examples/vite-like-dev — TS/JSX transform + bare-specifier ESM rewriting via esbuild.wasm
created: 2026-06-08
why: the mini dev-server's TS/JSX transform and bare-specifier rewriting rows are ❌ Pending in the m10 matrix — superseded in spirit by real Vite (ADR-0050) but the example server itself never got esbuild wired
sources: [TASKS M10]
---
## Context
`examples/vite-like-dev` (the minimal Vite-equivalent) serves HTML/JS from VFS, watches files, broadcasts HMR — but two rows are ❌ Pending: "TS/JSX transformation via esbuild.wasm" and "ESM rewriting for bare specifiers". The esbuild.wasm transform plumbing now exists (`tools/shadow-registry/src/esbuild-binding.ts` `transformWithEsbuild()` over `runWasi`, ADR-0047) and real upstream `vite@5` runs in-process (ADR-0050), so the headline M10 goal is met by the real path — but the example dev-server was never upgraded to call the transform.
## Options / Next
Mostly superseded by ADR-0050 (real Vite is the proof). Either: (a) wire `examples/vite-like-dev` to `transformWithEsbuild()` for `.ts`/`.tsx` requests + add a small bare-specifier→`/node_modules/...` rewriter (uses ADR-0009 AST rewriter), closing the two matrix rows; or (b) record the example as superseded by real Vite and drop the rows. Decide whether the toy server still earns the wiring once real Vite ships. Parked behind real-Vite browser e2e priority.
## Reversibility
Reversible — example-local wiring over existing esbuild-binding + AST-rewriter primitives, no new public API / dep / ADR contradiction. Gate: decide example-vs-real-Vite scope; no decision subagent needed.
