---
area: runtime-wasi
status: ready
title: Standalone Node-runnable WASI example (05-wasi)
created: 2026-06-28
why: runtime-wasi is only a browser README snippet in examples; the high-willingness-to-integrate WASI segment wants to run a guest in 30s from a terminal and the article needs runnable code blocks
user_story: As a tool builder, I want to clone rifty and run a WASI guest over a memory VFS in 30 seconds without a browser, but today examples/standalone-usage has 01-vfs/02-semver/03-registry/04-shell and runtime-wasi is only a README reference.
epic: wasi-in-browser-showcase
sources: [docs/public/compat/wasi.md]
code: [examples/standalone-usage, packages/runtime-wasi/src]
---

## Context

`examples/standalone-usage` ships 01-vfs / 02-semver / 03-registry / 04-shell as Node-runnable scripts; runtime-wasi appears only as a browser README snippet. The pure `runWasi`-over-memory-VFS path is isomorphic (no COI needed). `examples/vite-like-dev` uses `runWasi` as a dependency, not as a focused example.

## Acceptance

- `examples/standalone-usage/05-wasi` is a Node-runnable script (the repo's example-run convention) that installs a memory sync-mirror (`MemoryFsSync` via `setSyncMirror`/`installMemoryMirror`), writes an input file, runs `esbuild.wasm` under `runWasi` so the guest READS that file via `path_open` (esbuild file-input/`--bundle`, NOT stdin) and writes an `--outfile`, then prints the output read back through the SAME mirror — a real `path_open` round-trip across the JS↔WASI boundary.
- It runs green in CI.
- The examples README lists it.

## Parity cases

- The example's output bytes match the same esbuild invocation in Node over the same input (a shared fixture with `playground/wasi-preset` where practical).

## Out of scope

- No browser/COI path (this is the isomorphic memory-VFS path).
- No non-esbuild guests.
- No OPFS backend.

## Decisions

- Memory sync-mirror (`MemoryFsSync`) only — `runWasi` resolves file syscalls through the global `syncMirror()`, not a VFS argument; keeps it COI-free and Node-runnable. No stdin/stdout shortcut (that would not exercise `path_open`).
- REVERSIBLE → CHANGELOG line; no ADR.
