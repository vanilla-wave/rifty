# ADR 0357: Git facade carries exact storage read failures; absence is proven, never inferred

Status: Accepted
Date: 2026-08

> TL;DR: `makeGit` wraps its fs and every facade method in an exact-read-failure
> carrier: a non-absence `readFile`/`readdir` rejection (not ENOENT/ENOTDIR/EISDIR)
> latched during an operation rethrows as-is — even when isomorphic-git swallowed
> it — and blocks the operation's remaining writes; consumers stop re-proving
> absence themselves.

## Context

isomorphic-git collapses storage failures into absence at one root:
`FileSystem.read` catch-alls every `readFile` rejection to `null`, `readdir`
maps non-ENOTDIR rejections to `[]`. Downstream: an unreadable ref resolves as
"unborn", `_commit`'s bare catch turns an unreadable parent ref into a
PARENTLESS commit that moves the branch (silent history orphaning), a failed
workdir readdir makes `status` report tracked files deleted. quota-perm-fail →
provenance-lie at the VFS→isomorphic-git boundary.

PR #260 first killed this class locally in Starter baseline glue
(`makeStarterGit` read-latch + vfs preflight reads). Class-kill inventory found
the same axis unguarded at every other consumer — shell `git` commands
(`packages/shell/src/commands/git.ts`) and the long-lived owner SCM instance
(`workbench-owner-runtime.ts`) — a 2nd/3rd reachable instance at one boundary:
§Class-kill demands one chokepoint, and per-consumer wrappers were double
machinery (the local preflight reads even spawned their own `observable-order`
fault row).

## Decision

The chokepoint is the facade (`packages/git/src/exact-read-failures.ts`, wired
in `makeGit`):

- fs wrap latches the first non-absence `readFile`/`readdir` rejection per
  in-flight operation; absence codes ENOENT/ENOTDIR/EISDIR pass through — they
  are POSIX probe outcomes real git treats as "not here" (EISDIR: resolving a
  short ref legitimately probes ref DIRECTORIES). The argless `readFile()`
  fs-capability probe is exempt.
- every facade method runs guarded: latched failure rethrows the exact original
  error even when the inner operation "succeeded" over the swallow.
- fail-stop: while a failure is latched, `writeFile`/`unlink`/`mkdir`/`rmdir`
  reject with it — a swallowed read never seeds a write (kills the parentless
  commit and the reset-over-empty-index worktree rewrite). Facade-issued
  workdir writes ride the same gated fs; only the clone-failure cleanup
  (`removeTree`) stays raw, cleanup must not be blocked.
- concurrency: operations on one facade instance run SERIALIZED (per-instance
  FIFO inside `guard`) — a latched failure belongs to exactly the operation
  whose window observed it, never to a concurrent sibling by timing.
  `stat`/`lstat` already propagate honestly in isomorphic-git and are not
  wrapped; the facade's own gitdir-existence probe (clone cleanup arming)
  classifies absence via the shared classifier and rethrows storage failures.
- latch sentinel is out-of-band: `undefined`/`null` rejection values keep exact
  identity; the FIRST non-absence rejection wins.
- fs wrap delegates verb-by-verb (never spreads `base.promises`): structural
  GitFs implementations with prototype-carried or receiver-bound methods stay
  valid.
- `isGitNotFound` exported: NotFound is now trustworthy absence, so consumers
  map it to null instead of catch-all; `commitRefusal`'s unborn probe adopts it
  (a latched ref failure no longer reads as "nothing to commit").

## Consequences

- Every consumer inherits the guarantee; Starter glue drops `makeStarterGit`,
  preflight object reads, and HEAD shape-probing for plain `resolveRef` +
  `isGitNotFound`. Fault proof: `packages/git/tests/read-failure-identity.fault.test.ts`
  + existing Starter baseline fault suite unchanged.
- Shell `git` command probes stop re-collapsing what the facade surfaced: the
  amend prior-commit read, revision-existence probes, and the unborn-log
  secondary branch lookup rethrow storage failures (`VfsError`) to the shell's
  loud generic path instead of emitting "nothing to amend", "pathspec did not
  match", or a fabricated branch name; absence keeps its native diagnostics.
  Fault proof: `packages/shell/tests/git-storage-failure.fault.test.ts`.
- Facade ops serialize per instance: a status issued during a long clone on the
  SAME instance completes after it — exact attribution outranks intra-instance
  parallelism; distinct instances stay independent. Head-of-line over a stalled
  network head (clone/fetch/pull/push) is same-process semantics — one facade
  instance ≈ one git client; real git in one process also runs one command at a
  time. Reachable surface unchanged: shell git commands build a fresh instance
  per command, Starter glue is sequential, and the long-lived owner SCM already
  serializes at the session-tools protocol tail. Fault suite pins the
  lifecycle: the queued local op makes no fs progress during the stall, a fresh
  instance proceeds, and network settlement releases the queue. Bounding the
  network stall itself is the transport's own axis, not the queue's.
- Over-loud corners accepted: optional isomorphic-git fallbacks (fetch haves,
  push thin-pack) abort on a real storage failure instead of degrading — real
  git errors there too. isomorphic-git's own clone-failure cleanup can be
  gate-blocked (partial `.git` residue behind the loud exact error) when
  rifty's `removeTree` fallback is not armed.
- Write-side swallows inside isomorphic-git with NO prior read failure (e.g.
  `FileSystem.mkdir` EACCES fall-through) stay uncovered — separate axis:
  `docs/backlog/shell/isogit-write-failure-swallows.md`.

## Corrections (active)

- 2026-08-15 — concurrency decision REPLACED. Original: a latched failure was
  attributed to every operation in flight ("over-loud beats a lie").
  Contract+RED attempt 4 on PR #260 blocked it (`observable-order` /
  `provenance-lie`: an unrelated concurrent call rejected with a sibling's EIO
  purely by timing). Decision now: per-instance FIFO serialization with exact
  attribution (Decision bullet above carries the current text). Pinned by
  `read-failure-identity.fault.test.ts` (same-instance no-progress hold,
  distinct-instance independence, queue recovery after rejection). A
  post-implementation verify round found the residual of the same class:
  a rejection delivered LATE by a `Promise.all`-abandoned read landed in the
  NEXT window. `capture` now latches into the window that ISSUED the read
  (context snapshot at verb entry; latching into a settled window is inert) —
  pinned by the abandoned-parallel-read fault case.
- 2026-08-15 — coordination-mechanism inventory for the FIFO (AGENTS.md
  §Architecture new-mechanism rule; fault-classes §Class-kill). Existing
  serialization authorities and their keys: `playground-session-tools-owner`
  request tail — orders SCM TOOL REQUESTS per session (protocol-order
  authority ABOVE the facade, also covers non-git operations);
  `install-stamp-authority` `enqueue` — orders root-claim stamp state per
  project root; package-owner serialization — instant-deps restore ∥ Starter
  baseline. None owns intra-instance git fs-operation windows; the facade FIFO
  is the single authority for that key (same promise-tail idiom as
  `install-stamp-authority`). Layering with the session-tools tail is a
  protocol superset queue above the correctness queue, not a duplicate:
  removing the upper keeps attribution exact; removing the lower breaks
  attribution for non-serialized consumers (shell per-command instances,
  Starter glue). Dependency-internal mechanisms at the same boundary,
  classified: isomorphic-git's GLOBAL per-refname `AsyncLock` (`acquireLock`,
  keyed by ref NAME/`packed-refs` string shared across ALL repos in the realm
  — couples same-named ref reads across instances only while one such read is
  in flight; the fault suite's holds ride loose-object reads, which take no
  such lock, exactly because that coupling is the dependency's, not the
  carrier's), `GitIndexManager`'s per-`${gitdir}/index` lock (namespaced, no
  cross-repo coupling), the workdir/stash `AsyncLock` (`acquireLock$1` —
  MIXED keys: absolute stash-ref paths (namespaced) AND OBJECT literals that
  async-lock coerces to the single string `'[object Object]'`, i.e. one
  shared global slot serializing workdir-blob materialization and stash
  reflog updates across ALL repos — a second dependency-global coupling like
  the per-refname lock, held only for the wrapped step), and
  `GitShallowManager`'s lock (global object keyed by `join(gitdir,'shallow')`
  — namespaced per repo). Cross-repo coupling therefore exists at the
  per-refname keys AND the coerced `'[object Object]'` slot; both are the
  dependency's, brief, and orthogonal to the carrier. No lock-order
  inversion with the FIFO:
  the queue admits one operation which then acquires dependency locks
  strictly within its own lifetime; an operation never waits on another
  instance's queue, so no cycle can close through a dependency lock.
- 2026-08-15 — shell absence classifier hardened: `isNotFound` matched
  `/could not find/i` on MESSAGE TEXT, so a storage failure with
  NotFound-like wording read as git absence. Classification is now
  type-first: a `VfsError` is never absence; command probes rethrow storage
  failures before any absence mapping (fault suite
  `packages/shell/tests/git-storage-failure.fault.test.ts`).
