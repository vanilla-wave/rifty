---
area: runtime-wasi
status: parked
title: WASI symlink syscalls (path_symlink / path_readlink / path_link) — needs VFS symlink layer (M12)
created: 2026-06-08
why: VFS has no symlink layer, so all three return E_NOSYS; intentionally deferred to M12 until a real use case appears
user_story: As a dev running a compiled binary that creates or follows symlinks via `path_symlink`/`path_readlink`/`path_link` (or relies on `path_open` symlink-follow `dirflags`), I want them resolved, but today all three return `E_NOSYS` — the VFS has no symlink layer (deferred) so links and `lstat`/`realpath` divergence don't exist.
sources: [docs/public/compat/wasi.md, ADR-0050, PROJECT_PLAN M9 acceptance / M12]
---
## Context
`path_symlink`, `path_readlink`, `path_link` → `E_NOSYS` in `packages/runtime-wasi/src/syscalls/path.ts`. Root: `@riftydev/vfs` has no symlink layer — symlinks are intentionally absent (M9 acceptance). Calls return honest `E_NOSYS` rather than synthesising fake link metadata. `path_open`'s `dirflags` (symlink-follow) is likewise not enforced. Related: ADR-0050 ratified `lstat==stat` / `realpath==normalise` for the symlink-free VFS on the node:fs side, flagged for joint revisit at M12 (TODO(M12) in `fs.ts`).
## Options / Next
Deferred to M12. A symlink layer is a cross-cutting VFS change (new node type, link-resolution in path walk, realpath/lstat divergence on both node:fs and WASI sides) that ADR-0050 explicitly pairs with the M12 symlink rewrite. Pick up when an actual guest/tool needs symlinks; do the WASI three syscalls + node:fs lstat/realpath/symlink together. Until then E_NOSYS is the documented final behaviour.
## Reversibility
IRREVERSIBLE when taken up — adds a symlink layer to the lower `vfs` package (cross-package surface) and revisits ADR-0050; needs its own ADR (joint node:fs + WASI). Gate: a verified symlink use case (M12).
