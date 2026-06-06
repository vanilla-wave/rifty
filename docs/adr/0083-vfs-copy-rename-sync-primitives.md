# ADR 0083: VFS sync `copyFileSync` / `cpSync` / `renameSync` primitives for shell `cp`/`mv`

Status: Accepted (2026-06-06)
Date: 2026-06-06
Supersedes: the provisional rename-via-`copyTree`+`rm` of OPEN_QUESTIONS Q-2026-06-04-313 (promotes it to a native primitive)

## Context

The rich-terminal/coreutils work (`docs/research/rich-terminal-coreutils-2026-06-06.md` §5, §8 Q-vfs-cpmv, §9) needs `cp` and `mv` shell builtins. Today `FsSync` (`packages/vfs/src/fs-sync.ts`) has **no `copyFileSync`, no recursive copy, no `renameSync`** — only existsSync/readFileBytesSync/writeFileSync/readdirSync(→`VfsDirent`)/mkdirSync/rmSync/statSync/utimes. Two existing call sites already feel the gap:

- Playground file-manager rename (`apps/playground/src/glue/fs-ops.ts`): `renamePath` = recursive `copyTree` + `rmSync(old)` — honest, not a stub, but copies subtrees instead of moving and **drops mtime** (a fresh `writeFileSync` stamps `Date.now()`). Marked `// TODO(ADR): Q-2026-06-04-313`.
- Future `cp`/`mv` builtins would otherwise hand-roll the same naive read+write+rm at the shell layer.

Layer-attribution correction (research §2, §9): `path_rename` / `path_create_directory` etc. are **WASI preview1 guest syscalls inside the WASM sandbox** — reachable only from a guest, **not** from the JS shell layer, which holds only `syncMirror()` (`FsSync`) methods. cp/mv at the shell layer therefore need **VFS-level** primitives, not a WASI call and not a `syncMirror()`-registry method. Naive shell-side read+write+rm is **non-atomic** (a crash mid-op leaves both copies or a half-copy) and **mtime-lossy**.

`FsSync` is the single sync surface over the shared backend (ADR-0014, ADR-0037), implemented by `MemoryFsSync` (live `MemoryBackend` node tree) and `OpfsFsSync` (sync index+content+times maps with async OPFS write-through, ADR-0072). Adding to it is cross-package public API → **IRREVERSIBLE** (checklist item 1). ADR-0037 already foreshadowed this: *"future additions (`renameSync`, `copyFileSync`, etc.) land in `FsSync` only."*

## Decision

Add three methods to `FsSync`, both backends implementing, all `node:fs` *Sync*-faithful, all POSIX `VfsError` codes consistent with existing ops:

```ts
interface FsSync {
  // …existing…
  copyFileSync(src: string, dst: string): void;
  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void;
  renameSync(src: string, dst: string): void;
}
```

**`copyFileSync(src, dst)`** — single regular file. Copies bytes; `dst` mtime = now (a copy is a new file — matches `node:fs.copyFileSync`, which does **not** preserve mtime). Overwrites an existing file `dst` (Node default, no `COPYFILE_EXCL`). Errors: `ENOENT` if `src` absent / `dst` parent absent; `EISDIR` if `src` **or** `dst` is a directory (single-file copy never recurses).

**`cpSync(src, dst, {recursive})`** — recursive-copy story for `cp -r`:
- `recursive` omitted/false **and `src` is a dir** → `EISDIR` (mirrors `node:fs.cpSync`). File `src` with no `recursive` behaves as `copyFileSync`.
- `recursive: true` → file = `copyFileSync`; dir = `mkdirSync(dst,{recursive})` then copy each child (depth-first, lexicographic per `readdirSync`).
- **Partial-failure semantics:** copy is **best-effort, not transactional** — the backends have no rollback journal. On a child failure, throw the first `VfsError` (fail-fast); entries copied **before** the throw remain at `dst` (no cleanup). This is `node:fs.cpSync` parity (it also leaves partial output on error) and is honest — never swallow + return success.
- `dst` collision under a dir copy: per-file overwrite (Node `force: true` default). The shell `cp` builtin layers any "refuse to clobber" UX on top via `existsSync`; the VFS primitive does not editorialize.

**`renameSync(src, dst)`** — real atomic-where-possible move (the Q-2026-06-04-313 successor):
- **Same-dir** (basename change) and **cross-dir** both supported, single contract: detach `src` from its parent, attach under `dst`'s parent/basename. **mtime preserved** (a rename is not a content write).
- `MemoryFsSync`: move the live `Node` reference between parent `children` maps (a true O(1) in-place move — no byte copy, mtime untouched). Atomic w.r.t. other sync callers (single-threaded JS; the swap is one synchronous operation).
- `OpfsFsSync`: synchronously re-key `index` / `content` / `times` (and any open handle, via the existing subtree machinery), preserving the `times` entry so mtime survives; enqueue the async OPFS move through the paired async surface (`removeEntry` + re-create, tracked in `pending`/`flush`, ADR-0072). `FileSystemSyncAccessHandle` exposes no native rename, so on-disk atomicity is best-effort behind the async write-through; the **sync view is atomic** (the in-memory re-key is one synchronous step), which is what shell/`node:fs` callers observe.
- Dir-vs-file & overwrite (Node `fs.renameSync` parity): `dst` absent → move. `dst` exists as a **file** and `src` is a file → overwrite. `dst` exists as an **empty dir** and `src` is a dir → replace. `dst` is a **non-empty dir** → `ENOTEMPTY`. `dst` kind ≠ `src` kind → `EISDIR` / `ENOTDIR`. `src` absent → `ENOENT`. `src === dst` (post-normalize) → no-op. Renaming a dir into its own subtree → `EINVAL`.

Error codes draw only from the existing `VfsErrorCode` union (`packages/vfs/src/types.ts`) — `ENOENT`/`EEXIST`/`EISDIR`/`ENOTDIR`/`ENOTEMPTY`/`EINVAL` — no new codes. `node:fs.{copyFileSync,cpSync,renameSync}` in `runtime-js` route to these (a follow-up consumer, like ADR-0029's `utimesSync` pattern); not blocking this ADR.

**Playground migration:** `glue/fs-ops.ts` `renamePath` moves onto `renameSync` for the file (and dir) case; `copyTree` is retained only as the explicit `cp`-style deep-copy helper (or dropped in favor of `cpSync`). The `// TODO(ADR): Q-2026-06-04-313` marker is removed; collision UX (throw on existing `dst`) stays in the playground layer.

## Alternatives considered

- **(a) Native VFS primitives [chosen].** One source of truth, atomic-where-backend-allows, mtime-correct, layer-clean (lives where `rmSync`/`utimes` live). Cost: cross-package public-API change (IRREVERSIBLE), paid once across both backends — exactly the ADR-0029/0041 precedent.
- **(b) Shell-side read+write+rm [rejected].** What `fs-ops.ts` does today. Non-atomic (crash leaves duplicate/half state), **loses mtime** (write restamps now), duplicates the walk in every caller, and pushes filesystem semantics up into the dispatcher layer where partial-failure handling can't be centralized. Concretely fails the research §9 "cp/mv lack a VFS primitive" risk.
- **(c) Leave as-is, forbid `cp`/`mv` (`NotImplementedError`) [rejected].** Honest but `cp`/`mv` are T4 baseline coreutils and jsh ships both (research §3); refusing them guts the terminal/agent-bash surface for no benefit once (a) is a bounded, well-precedented change.

WASI `path_rename` was **not** an option: it is a guest syscall, unreachable from the shell layer (the attribution this ADR corrects).

## Consequences

- `FsSync` gains three methods, paid once; new backends must implement them (IRREVERSIBLE, checklist item 1). TSDoc added to each per the public-API rule.
- `mv`/rename is now O(1) in-place on the memory backend and mtime-faithful on both — large-tree rename no longer copies (the perf concern Q-2026-06-04-313 flagged).
- `cp -r` partial-failure is best-effort/fail-fast, documented; not transactional (no backend rollback). Compat-matrix notes this divergence class.
- Playground rename loses its `copyTree`+rm workaround; one fewer hand-rolled fs primitive above the VFS layer.
- OPFS rename durability is best-effort behind async write-through (same shape as ADR-0072 writes / ADR-0029 mtime side-table); sync view is correct and atomic. A page closed before `flush()` leaves OPFS slightly behind — acceptable for a dev runtime, consistent with existing OPFS ops.
- `node:fs` copy/rename family becomes implementable in `runtime-js` (follow-up), closing a compat gap.

## Reversibility classification

**IRREVERSIBLE** — checklist item 1: adds public API to `@riftydev/vfs` `FsSync`, consumed across the package boundary (runtime-js, shell, playground). Recorded as this inline ADR per ADR-0063. Supersedes/promotes provisional Q-2026-06-04-313 (a reconsideration of a recorded decision → decided here by a dedicated decision subagent; ADRs immutable).

## Acceptance

- [ ] `copyFileSync`, `cpSync`, `renameSync` declared on `FsSync` (`packages/vfs/src/fs-sync.ts`) with TSDoc.
- [ ] `MemoryFsSync` implements all three; `renameSync` moves the live `Node` reference (no byte copy) and **mtime is preserved** (assert `statSync(dst).mtime === pre-rename mtime`).
- [ ] `OpfsFsSync` implements all three; `renameSync` re-keys `index`/`content`/`times` synchronously preserving mtime, enqueues async OPFS move via `pending`/`flush`.
- [ ] `copyFileSync` exists and overwrites; `EISDIR` when `src`/`dst` is a dir.
- [ ] `cpSync` without `recursive` on a dir → `EISDIR`; with `recursive` deep-copies; partial-failure is fail-fast leaving copied entries in place (test asserts the first `VfsError` propagates and a pre-failure child exists at `dst`).
- [ ] `renameSync` covers same-dir + cross-dir, `dst`-absent / file-overwrite / empty-dir-replace / `ENOTEMPTY` / kind-mismatch / `src`-absent `ENOENT` / `src===dst` no-op / into-own-subtree `EINVAL`.
- [ ] All error codes are members of the existing `VfsErrorCode` union (no new codes).
- [ ] `apps/playground/src/glue/fs-ops.ts` rename migrated off `copyTree`+rm onto `renameSync` for the file case; `// TODO(ADR): Q-2026-06-04-313` marker removed (`pnpm todo:adr`).
- [ ] Cross-package type check passes (`pnpm typecheck`) — third-party `FsSync` adapters get a `tsc` error until they add the three methods (no silent shape drift, per ADR-0041 precedent).
- [ ] Parity cases (per ADR-0086): `node:fs.renameSync` mtime-preservation and `cpSync` recursive/partial-failure agree with Node where `node:fs`-expressible.
- [ ] `OPEN_QUESTIONS.md` moves Q-2026-06-04-313 to "Promoted" with this ADR as resolution.
