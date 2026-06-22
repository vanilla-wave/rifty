# Changelog

## [Unreleased]

### Added

- Initial `@riftydev/git`: git capability over the VFS (isomorphic-git).
- `vfsToGitFs` adapter: exposes a rifty `Vfs` as isomorphic-git's `fs.promises` API — byte/utf8 round-trips, name-listing `readdir`, synthesised POSIX `stat`/`lstat` (fixed `100644`/`040755` modes, per-path stable `ino`), `ENOENT` on missing paths, and symlink-less loud-throws (`readlink`→`ENOENT`, `symlink`→`EPERM`, `chmod` no-op).
- `makeGit({ fs, dir })` facade: typed LOCAL porcelain over isomorphic-git — `init` (defaultBranch `main`), `add`/`remove`, `status` (head/workdir/stage matrix code), `commit` (committer defaults to author), `log`, `currentBranch`, `listBranches`, `resolveRef`, `hashBlob`. NETWORK verbs `clone`/`fetch`/`pull`/`push` loud-throw `NotImplementedError` (transport lands in a later phase). Proven init→add→commit→log round-trip over a real `MemoryVfs`.
- `diff()`: per-file changes between the HEAD tree and the working dir via isomorphic-git `walk()` (`TREE(HEAD)` vs `WORKDIR`) — classifies `add`/`modify`/`delete`, emits structured `DiffEntry[]` (`filepath`, `change`, unified `DiffHunk[]`). Real LCS line diff (`lineDiff`, own module) with 3-line context, not git-diff byte-exact text (presentation lands later). Proven over a real `MemoryVfs`.
- Frozen golden fixtures `fixtures/*.porcelain` + `fixtures/log-oneline.txt` (ADR-0093): real git 2.50.1 `status --porcelain` (untracked / staged / mixed) + `log --oneline` output, captured once by `tools/git-fixtures/generate.mjs` (fixed identity+dates, `LC_ALL=C`, branch `main`), provenance-headed. Byte-asserted by `@riftydev/shell`'s `git-fixtures.test.ts`; tests never spawn git — regeneration is a deliberate manual act.
- `getGitCorsProxyUrl()`: D-004 (ADR-0028) tiered env-config for the git CORS-proxy URL — bootstrap global → Vite `import.meta.env` → `process.env.RIFTY_GIT_CORS_PROXY` → `''` (no proxy configured). Never a hardcoded host. (Transport wiring lands in a later phase.)
- `riftyGitHttp({ request? })`: isomorphic-git `http` plugin backed by `@riftydev/net` egress (not isomorphic-git's stock web client), so git smart-HTTP shares `node:http` routing. Streams the request body chunk-by-chunk into the net request, drains the response into an `AsyncIterableIterator<Uint8Array>`, propagates errors, honours an `AbortSignal`. Net `request` injectable for tests (the network boundary). Exports `GitHttpRequest`/`GitHttpResponse`. (Not yet wired into clone/push.)
