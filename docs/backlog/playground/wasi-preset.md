---
area: playground
status: ready
title: Clickable WASI preset — real esbuild.wasm guest over the shared VFS
created: 2026-06-28
why: WASI (a real compiled esbuild.wasm guest sharing files with node:fs) is rifty's one uncontested capability, but no user-facing "run a WASI guest" surface exists for the article to point at
user_story: As a developer evaluating rifty's WASI claim, I want to click a preset and watch a file written by node:fs get read+rewritten by esbuild.wasm as a WASI guest, but today there is no WASI preset and the esbuild path uses a stdin/stdout transform that never touches a VFS file.
epic: wasi-in-browser-showcase
sources: [ADR-0316, docs/public/compat/wasi.md]
code: [apps/playground/src/presets.ts, packages/runtime-wasi/src/syscalls/path.ts]
---

## Context

`presets.ts` ships 7 presets, none WASI-facing. `path_open` +
`fd_read`/`fd_write`/`fd_pread`/`fd_pwrite` are implemented
(`packages/runtime-wasi/src/syscalls/path.ts`, `fd.ts`), and exact
`@esbuild/wasi-preview1@0.28.0` package conformance exists. ADR-0316 removes the
checked-in carrier: the preset must acquire the package only after explicit user
selection and prove its own provenance. `docs/public/compat/wasi.md`: 25
implemented / 8 partial (incl `path_open` ⚠️) / 13 honest `E_NOSYS`.

## Acceptance

- A new from-scratch "WASI" preset declares exact
  `@esbuild/wasi-preview1@0.28.0` in its visible `package.json`. The ordinary
  validating project install owns tarball integrity and lockfile provenance;
  no baked snapshot, alias, overlay, host asset URL, or shadow runtime binding
  supplies the guest.
- Before execution, the preset checks the installed
  `node_modules/@esbuild/wasi-preview1/esbuild.wasm` against the shared strict
  ADR-0316 fixture (version, npm integrity, member size, member SHA-256). Any
  drift loud-fails before `WebAssembly.compile`.
- The preset visibly runs those bytes under `runWasi` as a WASI-preview1 guest
  that READS a VFS file written by `node:fs` (e.g. `/work/entry.ts` via an
  esbuild file-input / `--bundle` path) and WRITES output back to the VFS, both
  visible to `node:fs` in the same sandbox.
- A Playwright e2e opens the preset, observes the separate preview1 package
  request only after selection, and asserts the input file is consumed and the
  output file appears via `node:fs`. Existing Vite journeys retain zero
  `@esbuild/wasi-preview1` requests.
- The preset blurb states it is a real compiled WASI-preview1 binary (esbuild), explicitly distinct from `node:sqlite` (sql.js WASM, NOT WASI).

## Parity cases

- Package-sourced `esbuild.wasm` reading an on-VFS entry file via `path_open`
  and writing an on-VFS output produces the same bytes as exact host
  `esbuild@0.28.0` over the same input. This is one shared fixture with the
  standalone example, pinning the file round-trip rather than stdin transform.

## Out of scope

- No new syscalls — `path_open` is implemented; if the file round-trip exposes a `path_open` ⚠️ fidelity gap, that is a separate `runtime-wasi/*` item (named when found, never a silent stub).
- No non-esbuild WASI guests.
- No labeling `node:sqlite` (sql.js) as WASI — it is WASM.
- No restoration of a checked-in binary, Workbench esbuild capability,
  dependency snapshot, alias, or install overlay.

## Decisions

- Demonstrate via an esbuild file-input / `--bundle` invocation (which exercises `path_open`) rather than the stdin transform pipe.
- ADR-0316 owns exact package provenance: version `0.28.0`, npm integrity
  `sha512-6Mm1hljxx5NJgqnZupvOLfGGKW+9icZUottY+D1a7+QmddYogj84mAFfgZiobQG4qMbW9tIQubV0lL9XGFKLiw==`,
  member size `20174983`, SHA-256
  `c98e9dd502b5c59645e7cf1b6ee85d167fbce34fcf270cbafbadec257b318d2b`.
- REVERSIBLE → CHANGELOG line in apps/playground; no ADR.
