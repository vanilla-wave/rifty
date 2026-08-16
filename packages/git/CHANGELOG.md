# Changelog

## [Unreleased]

### Fixed

- `makeGit` operations serialize per instance with exact failure attribution
  (never a concurrent sibling's error by timing); the latch keeps
  `undefined`/`null` rejection identity (first failure wins) and fail-stops all
  four mutating verbs; the fs wrap delegates verb-by-verb so prototype-backed
  `GitFs` implementations stay valid; the clone gitdir probe classifies only
  proven absence — a storage failure there can no longer arm the destructive
  clone-failure cleanup (ADR-0357 Corrections).

- Every `makeGit` operation now carries the exact storage read failure instead
  of isomorphic-git's absence collapse: non-absence `readFile`/`readdir`
  rejections rethrow as-is (even after an internally swallowed "success") and
  fail-stop the operation's remaining writes, so an unreadable ref can no
  longer orphan history or fake an unborn branch; `isGitNotFound` exported as
  the now-trustworthy absence classifier (ADR-0357).

- Status classification now covers the complete reachable isomorphic-git
  matrix as a closed typed domain. Staged deletion followed by same-path
  recreation (`110`/`120`) preserves both real porcelain rows (`D ` and `??`),
  while an unknown future matrix code becomes an explicit per-path gap without
  erasing supported siblings; strict consumers use one preflight adapter to
  loud-throw before acting (ADR-0284). A generated Git 2.50.1 oracle now
  freezes all 15 HEAD/index/worktree relations and replays the same state setups
  through the package classifier.
- `status()` no longer refreshes or rewrites `.git/index`; unchanged working
  bytes remain a read-only query even when host stat metadata changed.
- **Git worktree mutations publish one complete path plan before applying bytes.** `makeGit({ assertPortablePaths })` now preflights hard reset, restore, branch switch, merge, cherry-pick, stash push/apply/pop, clone checkout, and pull checkout; a host rejection leaves ordinary paths untouched. Network clone/pull split fetch from checkout so fetched trees are known before policy runs. Guards: `worktree-preflight.test.ts`, `network.integration.test.ts`.
- **Annotated tag commit-ish peeling is now commit-safe.** `resolveRevision`, `reset`, checkout detach/start-points, and commit reads peel annotated tags to commits before parent walks or ref writes; annotated tags that target non-commit objects are rejected before HEAD can be corrupted. Guards: `revspec-show-log.test.ts`, `checkout.test.ts`.
- **fs-adapter `readFile` honors the STRING encoding form (`'utf8'`), not just `{ encoding: 'utf8' }` — `.gitignore` is now actually honored.** isomorphic-git's ignore manager reads `.gitignore` via `fs.readFile(path, 'utf8')`; the adapter previously returned raw bytes for that call, so ignore rules never parsed and ignored files (`node_modules`, build output, `*.log`) leaked into `git status`, `git add .`, and `isIgnored`. Now excluded. Guard: `gitignore.test.ts` (RED-checked).
- **`diff()` detects binary content** (NUL-byte heuristic) and emits a `binary: true` marker (rendered as git's `Binary files … differ`) instead of a lossy UTF-8 line-diff of mojibake. Guard: `diff.test.ts`.
- **fs-adapter `ino` is derived from mtime — same-size content edits are no longer silently trusted as unchanged.** isomorphic-git's `compareStats` compares mtime only at second granularity but `ino` exactly; deriving `ino` from the full-precision (strictly-monotonic) VFS mtime makes a sub-second, same-byte-length edit visible to `git status`/`diff` (was a silent-data-loss Fidelity bug — ADR-0167). Guards: `same-size-edit-fidelity.test.ts` + `@riftydev/vfs` `mtime-monotonic.test.ts`.
- **`fetch`/`pull` accept a `remote` name** (`FetchArgs`/`PullArgs` gain `remote?`), so the shell's `git fetch origin` / `git pull origin main` resolve the remote from config instead of mistaking the name for a URL transport.
- **Hard-ceil audit fixes for tree selection and object display.** `diff()` now supports staged diffs against an explicit base (including unborn HEAD = empty tree) and one-ref worktree diffs; `reset --hard` removes tracked worktree paths absent from the target tree; `show(<commit>)` carries the commit patch (root commit vs empty tree, otherwise first parent) instead of only the summary. Guards: `git-cli.test.ts` RED→GREEN.
- **Review hard-ceil fixes for diff/revspec/log/show fidelity.** `diff()` no longer applies checkout-style pathspec errors (missing pathspec → empty diff; trailing-slash directory pathspecs match), and `diff HEAD` treats index-removed files as deleted even if the bytes remain untracked on disk. Unsupported reflog/peel revspecs now throw directed `NotImplementedError`s; `log({ depth: 0 })` returns no commits; `show('REV:path')` reports the selected blob oid, not the containing commit/tree oid. Guards: `diff.test.ts`, `revspec-show-log.test.ts`, `git-cli.test.ts`.
- **Revspec `^0` fidelity.** `resolveRevision('HEAD^0')` now resolves to the current commit instead of looking for parent `-1`, so shell porcelain can use `HEAD^0` anywhere parent arithmetic is supported. Guard: `revspec-show-log.test.ts`.
- **Network arg surface widened to the isomorphic-git-supported ref/tag subset.** `CloneArgs` gains `noTags`; `FetchArgs`/`PullArgs` gain `remoteRef` and prune fields; `FetchArgs` gains `tags`; `PushArgs` gains `remoteRef` and `delete`. The shell uses these to support single refspecs and tag/prune flags without exposing unsupported multi/wildcard refspecs as fake successes.
- **Restore recreates missing parent directories.** `checkout({ op:'restore' })` now creates parent dirs before writing blobs restored from either the index or a tree-ish, so tracked nested paths recover after their directory was removed instead of surfacing VFS `ENOENT`. Guards: `checkout.test.ts`.
- **Facade force-add and annotated-tag fidelity.** `add(filepath, { force:true })` now forwards to isomorphic-git's force path so ignored explicit files can be staged when porcelain asks for `-f`; annotated tags without a message now loud-throw `git.tag.editor` instead of fabricating the tag name as message. Guards: `git-cli.test.ts`.

### Added

- `show(':path')` now returns the staged index blob for SCM Index diffs,
  matching git's index revspec instead of forcing every UI diff through HEAD or
  the worktree.
- `porcelainStatusLines(code)`: shared statusMatrix → ordered porcelain-row
  classifier for shell
  `git status --porcelain` and playground SCM status projections, keeping the
  rifty-git status labels on one public facade. It covers every reachable
  matrix state, including multi-row `110`/`120`, instead of dropping a raw
  3-character code into consumers.
- `commitRefusal(git)` + `EMPTY_COMMIT_MESSAGE_ERROR`: the empty/no-op commit
  refusal classifier hoisted from the shell builtin so shell `git commit` and the
  playground SCM owner RPC refuse identically (ADR-0184).
- **Git porcelain hard-ceil expansion.** `makeGit()` now exposes parent revspec
  resolution (`HEAD~n`, `^`), tree-selecting `diff()` modes (unstaged, staged,
  HEAD↔worktree, ref↔ref), `reset` soft/mixed/hard, `show`, tag CRUD, remote
  CRUD + ls-remote, merge, cherry-pick, stash, plus typed result/input surfaces.
  Reset rebuilds index/worktree from real tree objects; merge materializes the
  merged HEAD back into the VFS. Shell coverage exercises the public facade over
  a real Memory VFS.
- `makeGit().commit({amend})` + `getConfig`/`setConfig`/`unstage`: facade primitives for the shell's `commit --amend`, `git config`, and `git restore --staged`/`reset <file>`. `commit({amend:true})` replaces HEAD (parent preserved, oid changes, log length unchanged) via isomorphic-git `amend`. `getConfig(path)`/`setConfig(path,value)` read/write local `.git/config` (unset → undefined). `unstage(filepath)` moves the index stage 2→0 (`resetIndex`), HEAD untouched. `amend?` added to the exported `CommitArgs`. Proven over a real `MemoryVfs` (`config-amend.test.ts`).
- `pathspecMatch(path, spec)` exported: the module-level pathspec predicate (exact or `<spec>/…` dir-prefix) is now public, so the shell's `git checkout` reuses git's own rule instead of re-inlining it.
- `makeGit().checkout(input)` + `listFiles()`: facade primitives for `git checkout`. Discriminated `CheckoutInput` → structured `CheckoutResult` (the shell renders byte-exact git text from it). `op:'switch'` switches branch / detaches HEAD on a raw oid (native detached HEAD — `currentBranch()` undefined, `HEAD` holds the oid), creates `-b` branches (pre-checked → `BranchExistsError`, never iso-git's), reports `alreadyOn`/`created`/`detached` + `previousRef` + `headSubject`; a conflicting switch is caught and rethrown as rifty's `CheckoutConflictError(files)`. `op:'restore'` restores worktree paths from the INDEX (no iso-git primitive — `walk(STAGE)` over matched BLOBs, so a directory pathspec descends and restores each child → write worktree, HEAD/index untouched) or from a tree-ish `source` (`resolveRef` the SYMBOLIC source — branch/tag/HEAD, not just a raw sha — then `readBlob` → write → `add`, syncing the index). Multi-pathspec restore is ALL-OR-NOTHING: any unmatched pathspec throws `PathspecError` BEFORE writing anything (real git). New typed git USER errors `CheckoutConflictError`/`BranchExistsError`/`PathspecError` (normal git failures, NOT NotImplementedError ceilings) + types `CheckoutInput`/`CheckoutResult`. State conformance proven over a real `MemoryVfs` (`checkout.test.ts`).
- Initial `@riftydev/git`: git capability over the VFS (isomorphic-git).
- `vfsToGitFs` adapter: exposes a rifty `Vfs` as isomorphic-git's `fs.promises` API — byte/utf8 round-trips, name-listing `readdir`, synthesised POSIX `stat`/`lstat` (fixed `100644`/`040755` modes, per-path stable `ino`), `ENOENT` on missing paths, and symlink-less loud-throws (`readlink`→`ENOENT`, `symlink`→`EPERM`, `chmod` no-op).
- `makeGit({ fs, dir, http?, corsProxy?, onAuth? })` facade: typed LOCAL porcelain over isomorphic-git — `init` (defaultBranch `main`), `add`/`remove`, `status` (head/workdir/stage matrix code), `commit` (committer defaults to author), `log`, `currentBranch`, `listBranches`, `resolveRef`, `hashBlob`. Proven init→add→commit→log round-trip over a real `MemoryVfs`.
- NETWORK verbs `clone`/`fetch`/`pull`/`push` wired to isomorphic-git over smart-HTTP via `riftyGitHttp()` + the D-004 CORS proxy (`getGitCorsProxyUrl()`), with an `onAuth` credential bridge. Transport boundary is LOUD (`errors.ts`): non-smart-HTTP schemes throw `NotImplementedError('git.transport.<scheme>')` — `ssh`/`git` and scp-like `git@host:path` (browser ceiling: no raw TCP/SSH), `ftp:`/any other → unsupported. Browser-only proactive CORS guard: a cross-origin smart-HTTP target with no proxy throws `git.cors` before any request (INERT in Node — no `globalThis.location` — so real integration tests proceed). Underlying isomorphic-git network errors are mapped (`mapGitNetworkError`) and rethrown, never swallowed (push-from-shallow gets a directed message). New args/types `CloneArgs`/`FetchArgs`/`PullArgs`/`PushArgs`/`GitAuthProvider`/`GitHttp`. Transport + CORS loud-throws proven over a real `MemoryVfs` (guards fire before the network — no server).
- `diff()`: the UNSTAGED delta — index (`STAGE`) vs working dir, like bare `git diff` — via isomorphic-git `walk()` (`STAGE()` vs `WORKDIR()`). Classifies `modify`/`delete`, emits structured `DiffEntry[]` (`filepath`, `change`, unified `DiffHunk[]`). UNTRACKED and `.gitignore`-ignored files are NOT shown (absent from the index — real `git diff` never shows them; ignored dirs are pruned via `isIgnored` so a huge `node_modules` is not walked). Real LCS line diff (`lineDiff`, own module) with 3-line context, not git-diff byte-exact text (presentation lands later). Proven over a real `MemoryVfs`.
- Frozen golden fixtures `fixtures/*.porcelain` + `fixtures/log-oneline.txt` (ADR-0093): real git 2.50.1 `status --porcelain` (untracked / staged / mixed) + `log --oneline` output, captured once by `tools/git-fixtures/generate.mjs` (fixed identity+dates, `LC_ALL=C`, branch `main`), provenance-headed. Byte-asserted by `@riftydev/shell`'s `git-fixtures.test.ts`; tests never spawn git — regeneration is a deliberate manual act.
- `getGitCorsProxyUrl()`: D-004 (ADR-0028) tiered env-config for the git CORS-proxy URL — bootstrap global → Vite `import.meta.env` → `process.env.RIFTY_GIT_CORS_PROXY` → `''` (no proxy configured). Never a hardcoded host.
- `riftyGitHttp({ request? })`: isomorphic-git `http` plugin backed by `@riftydev/net` egress (not isomorphic-git's stock web client), so git smart-HTTP shares `node:http` routing. Streams the request body chunk-by-chunk into the net request, drains the response into an `AsyncIterableIterator<Uint8Array>`, propagates errors, honours an `AbortSignal`. Net `request` injectable for tests (the network boundary). Exports `GitHttp`/`GitHttpRequest`/`GitHttpResponse`.
- Real smart-HTTP clone integration test (`tests/network.integration.test.ts`): drives OUR `makeGit().clone()` against a real `git http-backend` CGI served over `node:http` (real refs negotiation, packfile, checkout) — no transport mock. Injects isomorphic-git's `http/node` real-TCP client via the `http` option (net's loopback registry isn't real TCP) so the facade still owns the call path. Deterministic bare repo (fixed identity+dates) → asserts the cloned `resolveRef('HEAD')` equals the canonical HEAD sha bit-for-bit. Capability-gated: loudly `console.warn`-skips when `git`/`git-http-backend` is genuinely unavailable (CI without the binary), never to dodge a real failure.
