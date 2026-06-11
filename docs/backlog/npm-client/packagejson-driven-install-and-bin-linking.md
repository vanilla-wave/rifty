---
area: npm-client
status: active
title: package.json-driven install() + node_modules/.bin linking
created: 2026-06-11
why: install() requires a hand-assembled deps map (no caller reads the VFS package.json) and no .bin shims are created, so installed CLIs (vite/tsc/eslint) aren't invokable by name — the gap between "install resolves" and "I can run my project"
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0050]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/linker.ts, packages/npm-client/src/registry.ts]
---

## Context

Two pure-plumbing, registry-agnostic gaps on the M11 "runs real-ish projects" theme. (1) `install()`
takes a hand-assembled deps map; every caller (e.g. `real-vite-bootstrap.ts`) builds it by hand — it
should read `dependencies`/`devDependencies`/`optionalDependencies`/`overrides`/`engines` from the
VFS `package.json` so `install` with no args works. (2) The linker writes `node_modules` but creates
no `.bin` shims; the manifest `bin` field isn't even parsed (absent from `VersionManifest`), so
installed CLIs can't be run by name. Per ADR-0050 (no symlinks) use a copy/shim strategy for `.bin`.

## Options or Next

- Parse the root `package.json` deps fields → feed `install()` when no explicit map is given.
- Add `bin` to `VersionManifest`; in the linker, write `node_modules/.bin` copy-shims for installed bins.
- Keep non-registry specs (git / file: / workspace: / http-tarball) and lifecycle scripts as loud,
  named `NotImplementedError` — they are separate, larger, and a curation slope (out of scope per the
  no-shadow-registry constraint). Do NOT slide into per-package fixes.

## Reversibility

REVERSIBLE — additive on top of the existing `install()`/linker; no public API break. Recorded here.
