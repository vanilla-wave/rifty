---
area: runtime-wasi
status: ready
title: Standalone Node-runnable WASI example (05-wasi)
created: 2026-06-28
why: runtime-wasi is only a browser README snippet in examples; the high-willingness-to-integrate WASI segment wants to run a guest in 30s from a terminal and the article needs runnable code blocks
user_story: As a tool builder, I want to clone rifty and run a WASI guest over a memory VFS in 30 seconds without a browser, but today examples/standalone-usage has 01-vfs/02-semver/03-registry/04-shell and runtime-wasi is only a README reference.
epic: wasi-in-browser-showcase
sources: [ADR-0316, docs/public/compat/wasi.md]
code: [examples/standalone-usage, packages/runtime-wasi/src]
---

## Context

`examples/standalone-usage` ships 01-vfs / 02-semver / 03-registry / 04-shell
as Node-runnable scripts; runtime-wasi appears only as a browser README snippet.
The pure `runWasi`-over-memory-VFS path is isomorphic (no COI needed).
ADR-0316 retires the vendored/product bridge but preserves an explicit exact
package-sourced preview1 guest.

## Acceptance

- The standalone example manifest declares exact
  `@esbuild/wasi-preview1@0.28.0` and `@riftydev/runtime-wasi`. The script
  resolves the installed package member via `createRequire(import.meta.url)`;
  no repository blob, network fetch helper, shadow binding, or hardcoded pnpm
  store path participates.
- Before execution it checks the package manifest and `esbuild.wasm` against
  the same strict ADR-0316 version/integrity/size/SHA-256 fixture as the browser
  preset; any drift loud-fails.
- `examples/standalone-usage/src/05-wasi.ts` installs a memory sync-mirror
  (`MemoryFsSync` via `setSyncMirror`/`installMemoryMirror`), writes an input
  file, runs the verified bytes under `runWasi` so the guest READS that file via
  `path_open` (esbuild file-input/`--bundle`, NOT stdin) and writes an
  `--outfile`, then prints the output read back through the SAME mirror — a real
  `path_open` round-trip across the JS↔WASI boundary.
- It runs green in CI.
- The examples README lists it.

## Parity cases

- The example's output bytes match exact host `esbuild@0.28.0` over the same
  input, using the same mandatory fixture as `playground/wasi-preset`.

## Out of scope

- No browser/COI path (this is the isomorphic memory-VFS path).
- No non-esbuild guests.
- No OPFS backend.
- No product esbuild activation, checked-in guest bytes, or dependency snapshot.

## Decisions

- Memory sync-mirror (`MemoryFsSync`) only — `runWasi` resolves file syscalls through the global `syncMirror()`, not a VFS argument; keeps it COI-free and Node-runnable. No stdin/stdout shortcut (that would not exercise `path_open`).
- ADR-0316 owns the exact package and shared provenance fixture; the example
  owns only explicit resolution and execution.
- REVERSIBLE → CHANGELOG line; no ADR.
