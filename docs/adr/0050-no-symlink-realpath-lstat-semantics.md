# ADR 0050: No-symlink `fs.realpath`/`fs.lstat` semantics

Status: Accepted (promotes Q-2026-05-29-002)
Date: 2026-05-29

## Context

`packages/runtime-js/src/builtins/fs.ts` previously made `lstatSync` and
`realpathSync` (and their async/callback forms) throw
`NotImplementedError(…, 'symlinks not supported until M12')`. A dedicated
contract test (`packages/runtime-js/src/builtins/fs.test.ts`) enforced that
loud-throw under the "No silent stubs" hard rule. The conservatism was
deliberate: keep the symlink-shaped call sites visible until a real consumer
exercised them.

That consumer arrived. To run upstream **Vite 5** in-process, its file watcher
(chokidar → readdirp) calls `util.promisify(fs.realpath)` and `fs.lstat` on
ordinary files on the **happy path**, and `readdirp` calls
`fs.readdir(path, {withFileTypes:true}, cb)`. The loud-throw aborted
`vite createServer` inside the watcher; the 2-arg-only `readdir` callback
mis-bound the options form. A standalone scout confirmed that with
`realpath`/`lstat` implemented and the 3-arg `readdir` callback supported,
`createServer` → `server.listen()` → `server.transformRequest('/src/main.js')`
all succeed in-process.

The rifty VFS has **no symlink layer**: `packages/vfs/src/` has no
symlink/readlink node kind; both backends (in-memory + OPFS) are link-free; the
WASI layer already encodes this honestly (`path_readlink`/`path_symlink` →
`E_NOSYS`, `docs/compat/wasi.md`). Symlink support is scoped to M12.

This decision was made via a dedicated deliberation agent with an adversarial
check (the M12 forward-compat trap). Reversible per the checklist (one file,
~12 LOC, no API-shape or dependency change) — but it edits a dedicated contract
test, so it is recorded here.

## Decision

For a filesystem with **no symlinks**, adopt the correct POSIX/Node semantics,
which for the symlink-free case reduce to:

- **D1 `lstat ≡ stat`.** `lstatSync(p)` returns `statSync(p)`. POSIX `lstat(2)`
  differs from `stat(2)` *only* by not following a final symlink; with no
  symlinks the two are definitionally identical. `Stats.isSymbolicLink()` stays
  `false`, so the result is internally consistent.
- **D2 `realpath ≡ normalise-if-exists`.** `realpathSync(p)` resolves to a
  normalised absolute path (`@rifty/vfs` `normalizePath`/`joinPath` against
  `process.cwd()`), then throws `ENOENT` if the entry doesn't exist. POSIX
  `realpath(3)` = absolutise + collapse `.`/`..` + resolve symlinks + ENOENT on
  a missing component; with symlink resolution vacuous it reduces exactly to
  absolutise + normalise + existence check. `realpathSync.native` /
  `fs.realpath.native` alias the same impl.
- **D3 `readlink` keeps honest errors.** `readlinkSync(p)` throws `ENOENT`
  (missing) / `EINVAL` (existing non-link) — never fabricates a target.
- **D4 `readdir` callback honours options.** The callback `readdir` accepts
  `(p, cb)` and `(p, {withFileTypes}, cb)` so readdirp binds the callback
  correctly.

These are the **correct and complete** answers for a symlink-free fs, not
placeholder values — so "No silent stubs" is satisfied, not violated. The rule
guards against fake values masking an unimplemented feature; here there is no
withheld feature, only the truthful canonical result. A non-existent path still
throws `ENOENT` (it is *not* silently normalised), which is the line that keeps
this honest.

## Test-contract change

The `fs.test.ts` block that asserted the loud-throw is rewritten to assert the
no-symlink contract, preserving the test's intent ("these symlink-shaped APIs
behave correctly for our fs model"): `lstatSync(existing)` matches `statSync`
incl. `isSymbolicLink() === false`; `realpathSync` performs real canonicalisation
(`/a/b/../b/f → /a/b/f`) and throws `ENOENT` on a missing path;
`realpathSync.native` aliases it; `readlinkSync` throws `EINVAL`/`ENOENT`. Per
"Never modify a test to make code pass": this is a legitimate contract
*evolution* — the M9 loud-throw was a documented provisional boundary, and the
forcing consumer moved it forward; the file still tests a real, stronger
contract. Happy-path/promise/callback coverage lives in
`tests/conformance/builtins/fs-realpath-readdir.test.ts`.

## Consequences

- `fs.ts`: `lstatSync → statSync`; `realpathSync` normalise+ENOENT with `.native`;
  async `lstat`/`realpath`/`access`/`readlink`/`copyFile`/`rename` callback forms;
  3-arg `readdir`. Unused `NotImplementedError` import removed.
- `fs.test.ts` rewritten as above; `fs-realpath-readdir.test.ts` added.
- Unblocks running real upstream Vite 5 in-process.

## Risks / follow-ups

- **M12 symlink interaction (load-bearing):** when the VFS gains a symlink node
  kind, `lstatSync`, `realpathSync`, `readlinkSync`, and `Stats.isSymbolicLink()`
  MUST be revisited together. Anchored by the `TODO(M12)` marker in `fs.ts`.
  Until then, internal consumers must not assume `realpath`/`lstat` distinguish
  links (none exist).

## References

- Q-2026-05-29-002 (promoted here).
- ADR-0047 / ADR-0049 (esbuild + WASI cwd — toolchain pass that made Real Vite
  the forcing consumer); ADR-0043 (Vite-in-Worker); ADR-0041 (`readdir` Dirent).
- CLAUDE.md hard rules: "No silent stubs"; "Never modify a test to make code pass".
- POSIX `lstat(2)`, `realpath(3)`, `readlink(2)`.
