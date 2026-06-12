---
area: runtime-js
status: parked
title: fs.promises.open() and FileHandle API
created: 2026-06-12
why: M11 added callback/sync fd APIs plus promises mkdtemp/opendir/truncate, but the richer FileHandle object surface is larger than the high-frequency fd wall and should not be faked
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

The M11 fd slice exposes `open`/`read`/`write`/`close`/`fstat`/`ftruncate`
callback and sync forms, plus `promises.mkdtemp`, `promises.opendir`, and
`promises.truncate`. It deliberately does not expose `fs.promises.open()`, since
that returns a long-lived `FileHandle` object with async methods, lifetime rules,
and Node-specific disposal behavior.

## Options or Next

- Add `fs.promises.open()` only when a package actually needs `FileHandle`.
- Reuse the runtime-local fd table internally, but document path-backed semantics
  unless the lower VFS fd API lands first.
- Include `readFile`/`writeFile`/`read`/`write`/`stat`/`truncate`/`close` methods
  and rejected-use-after-close behavior in the first tested slice.

## Reversibility

REVERSIBLE local runtime-js API addition, but should be parity-tested before it
is exposed because ecosystem code tends to rely on `FileHandle` lifetime details.
