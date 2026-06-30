# ADR 0184: Hoist commit-refusal classifier to git facade

Status: Active
Date: 2026-06

> TL;DR: move the empty/no-op commit refusal classifier into `@riftydev/git`
> (`commitRefusal` + `EMPTY_COMMIT_MESSAGE_ERROR`) so the shell `git commit`
> builtin and the playground SCM owner RPC refuse identically.

## Context

Real git refuses to fabricate an empty commit (exit 1) and prints an exact
stdout summary per working-tree state ("nothing to commit, working tree clean",
"no changes added to commit…", etc.). Two realms reproduce this: the shell
`git commit` builtin and the playground SCM panel's owner-side
`commitResolvedIdentity`. They carried a byte-for-byte identical
`nothingToCommit` classifier and the same `Aborting commit due to empty commit
message.` string. A one-sided wording/detection fix (e.g. a git-version parity
correction) would silently diverge panel-commit from shell-commit — exactly the
drift ADR-0179 hoisted `porcelainXY` to prevent.

## Decision

Move the classifier to `@riftydev/git` and export `commitRefusal(git)` +
`EMPTY_COMMIT_MESSAGE_ERROR` through the package's public API. It takes the git
facade (`Pick<Git, 'status' | 'resolveRef'>`) and returns the exact refusal
stdout line or `null` when a commit may proceed. Shell and playground both import
it; neither keeps a private copy.

## Consequences

- Panel-commit and shell-commit refuse identically by construction; the SCM
  epic's "behaves like `git commit`" contract has one source of truth.
- `@riftydev/git` gains a small public helper; refusal wording is now a package
  API change, parity-tested in shell's golden git-cli fixtures.
- No reverse import or app dependency from lower packages (same shape as 0179).
