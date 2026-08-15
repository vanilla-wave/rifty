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
- concurrency: a failure is attributed to every operation in flight on the
  instance (over-loud beats a lie; `stat`/`lstat` already propagate honestly in
  isomorphic-git and are not wrapped).
- `isGitNotFound` exported: NotFound is now trustworthy absence, so consumers
  map it to null instead of catch-all; `commitRefusal`'s unborn probe adopts it
  (a latched ref failure no longer reads as "nothing to commit").

## Consequences

- Every consumer inherits the guarantee; Starter glue drops `makeStarterGit`,
  preflight object reads, and HEAD shape-probing for plain `resolveRef` +
  `isGitNotFound`. Fault proof: `packages/git/tests/read-failure-identity.fault.test.ts`
  + existing Starter baseline fault suite unchanged.
- Over-loud corners accepted: optional isomorphic-git fallbacks (fetch haves,
  push thin-pack) abort on a real storage failure instead of degrading — real
  git errors there too. isomorphic-git's own clone-failure cleanup can be
  gate-blocked (partial `.git` residue behind the loud exact error) when
  rifty's `removeTree` fallback is not armed.
- Write-side swallows inside isomorphic-git with NO prior read failure (e.g.
  `FileSystem.mkdir` EACCES fall-through) stay uncovered — separate axis:
  `docs/backlog/shell/isogit-write-failure-swallows.md`.
