# ADR 0050: No-symlink `fs.realpath`/`fs.lstat` semantics

Status: Accepted (promotes Q-2026-05-29-002)
Date: 2026-05-29

## Context

`packages/runtime-js/src/builtins/fs.ts` made `lstatSync`/`realpathSync` (and
async/callback forms) throw `NotImplementedError(…, 'symlinks not supported
until M12')`, with a contract test in `fs.test.ts` enforcing the loud-throw
under "No silent stubs" — keeping symlink-shaped call sites visible until a real
consumer hit them.

That consumer is upstream **Vite 5** in-process: its watcher (chokidar →
readdirp) calls `util.promisify(fs.realpath)` and `fs.lstat` on ordinary files
on the happy path, and `readdirp` calls `fs.readdir(path, {withFileTypes:true},
cb)`. The loud-throw aborted `vite createServer`; the 2-arg-only `readdir`
callback mis-bound the options form. A scout confirmed that with
`realpath`/`lstat` implemented and the 3-arg `readdir` callback, `createServer`
→ `server.listen()` → `transformRequest('/src/main.js')` succeed in-process.

The rifty VFS has **no symlink layer**: `packages/vfs/src/` has no
symlink/readlink node kind; both backends (in-memory + OPFS) are link-free; WASI
already returns `E_NOSYS` for `path_readlink`/`path_symlink` (`docs/compat/wasi.md`).
Symlinks are scoped to M12.

Decided via a deliberation agent with an adversarial check (the M12
forward-compat trap). Reversible per checklist (one file, ~12 LOC, no API/dep
change) but edits a dedicated contract test, so recorded here.

## Decision

For a symlink-free filesystem, adopt correct POSIX/Node semantics, which reduce
to:

- **D1 `lstat ≡ stat`.** `lstatSync(p)` returns `statSync(p)`. POSIX `lstat(2)`
  differs from `stat(2)` only by not following a final symlink; with no symlinks
  they are identical. `Stats.isSymbolicLink()` stays `false`.
- **D2 `realpath ≡ normalise-if-exists`.** `realpathSync(p)` resolves to a
  normalised absolute path (`@riftydev/vfs` `normalizePath`/`joinPath` against
  `process.cwd()`), then throws `ENOENT` if the entry is missing. POSIX
  `realpath(3)` with symlink resolution vacuous reduces to absolutise +
  collapse `.`/`..` + existence check. `realpathSync.native` / `fs.realpath.native`
  alias the same impl.
- **D3 `readlink` keeps honest errors.** `readlinkSync(p)` throws `ENOENT`
  (missing) / `EINVAL` (existing non-link) — never fabricates a target.
- **D4 `readdir` callback honours options.** Accepts `(p, cb)` and
  `(p, {withFileTypes}, cb)` so readdirp binds correctly.

These are the correct and complete answers for a symlink-free fs, not
placeholders — "No silent stubs" is satisfied: there is no withheld feature,
only the truthful canonical result. A non-existent path still throws `ENOENT`
(not silently normalised), which keeps this honest.

## Test-contract change

The `fs.test.ts` loud-throw block is rewritten to assert the no-symlink contract
(preserving intent — "these symlink-shaped APIs behave correctly for our fs
model"): `lstatSync(existing)` matches `statSync` incl. `isSymbolicLink() ===
false`; `realpathSync` canonicalises (`/a/b/../b/f → /a/b/f`) and throws `ENOENT`
on a missing path; `realpathSync.native` aliases it; `readlinkSync` throws
`EINVAL`/`ENOENT`. Per "Never modify a test to make code pass": legitimate
contract *evolution* — the M9 loud-throw was a documented provisional boundary
that the forcing consumer moved forward; the file still tests a stronger
contract. Happy-path/promise/callback coverage lives in
`tests/conformance/builtins/fs-realpath-readdir.test.ts`.

## Consequences

- `fs.ts`: `lstatSync → statSync`; `realpathSync` normalise+ENOENT with
  `.native`; async `lstat`/`realpath`/`access`/`readlink`/`copyFile`/`rename`
  callback forms; 3-arg `readdir`. Unused `NotImplementedError` import removed.
- `fs.test.ts` rewritten as above; `fs-realpath-readdir.test.ts` added.
- Unblocks running real upstream Vite 5 in-process.

## Risks / follow-ups

- **M12 symlink interaction (load-bearing):** when the VFS gains a symlink node
  kind, `lstatSync`, `realpathSync`, `readlinkSync`, and `isSymbolicLink()` MUST
  be revisited together. Anchored by the `TODO(M12)` marker in `fs.ts`. Until
  then, internal consumers must not assume `realpath`/`lstat` distinguish links
  (none exist).

## References

- Q-2026-05-29-002 (promoted here).
- ADR-0047 / ADR-0049 (esbuild + WASI cwd — toolchain pass that made Real Vite
  the forcing consumer); ADR-0043 (Vite-in-Worker); ADR-0041 (`readdir` Dirent).
- CLAUDE.md hard rules: "No silent stubs"; "Never modify a test to make code pass".
- POSIX `lstat(2)`, `realpath(3)`, `readlink(2)`.
