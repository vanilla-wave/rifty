---
area: playground
status: ready
title: Clickable WASI preset — real esbuild.wasm guest over the shared VFS
created: 2026-06-28
why: WASI (a real compiled esbuild.wasm guest sharing files with node:fs) is rifty's one uncontested capability, but it's internal to the esbuild transform — no user-facing "run a WASI guest" surface exists for the article to point at
user_story: As a developer evaluating rifty's WASI claim, I want to click a preset and watch a file written by node:fs get read+rewritten by esbuild.wasm as a WASI guest, but today there is no WASI preset and the esbuild path uses a stdin/stdout transform that never touches a VFS file.
epic: wasi-in-browser-showcase
sources: [docs/public/compat/wasi.md]
code: [apps/playground/src/presets.ts, packages/workbench/src/workers/esbuild-wasi-transform.ts, packages/runtime-wasi/src/syscalls/path.ts]
---

## Context

`presets.ts` ships 7 presets, none WASI-facing. `path_open` + `fd_read`/`fd_write`/`fd_pread`/`fd_pwrite` are implemented (`packages/runtime-wasi/src/syscalls/path.ts`, `fd.ts`), and `esbuild-wasi-transform.ts` mounts a workspace preopen — BUT it feeds source via stdin and reads via stdout (transform mode), so no shipped path demonstrates a real `path_open` file round-trip. `docs/public/compat/wasi.md`: 25 implemented / 8 partial (incl `path_open` ⚠️) / 13 honest `E_NOSYS`.

## Acceptance

- A new "WASI" preset visibly runs `esbuild.wasm` under `runWasi` as a WASI-preview1 guest that READS a VFS file written by `node:fs` (e.g. `/work/entry.ts` via an esbuild file-input / `--bundle` path) and WRITES output back to the VFS, both visible to `node:fs` in the same sandbox.
- A playwright e2e opens the preset and asserts the input file is consumed and the output file appears via `node:fs`.
- The preset blurb states it is a real compiled WASI-preview1 binary (esbuild), explicitly distinct from `node:sqlite` (sql.js WASM, NOT WASI).

## Parity cases

- `esbuild.wasm` reading an on-VFS entry file via `path_open` and writing an on-VFS output produces the same bytes as the same esbuild invocation in Node over the same input (a fixture pinning the `path_open` file round-trip, not the stdin transform).

## Out of scope

- No new syscalls — `path_open` is implemented; if the file round-trip exposes a `path_open` ⚠️ fidelity gap, that is a separate `runtime-wasi/*` item (named when found, never a silent stub).
- No non-esbuild WASI guests.
- No labeling `node:sqlite` (sql.js) as WASI — it is WASM.

## Decisions

- Demonstrate via an esbuild file-input / `--bundle` invocation (which exercises `path_open`) rather than the stdin transform pipe.
- REVERSIBLE → CHANGELOG line in apps/playground; no ADR.
