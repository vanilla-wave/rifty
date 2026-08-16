---
area: shell
status: draft
title: git branch <name> silently ignores the name — lists instead of creating
created: 2026-08-15
why: real git creates the branch and prints nothing; rifty prints the branch list and exits 0 — a silent stub of branch creation
sources: [PR #260 re-cut 9 fixture debugging]
code: [packages/shell/src/commands/git.ts]
---

## Context

`case 'branch': return doBranch(g, ctx);` drops the positional argument:
`git branch feature-x` prints `* main` and exits 0 while creating NOTHING.
Real git 2.50.1 creates `refs/heads/feature-x` at HEAD and prints nothing.
Every downstream consumer that trusts exit 0 then operates on a missing
branch (observed: fault-suite seeds produced genuine-absence diagnostics that
masked the storage-failure injection they meant to test). `checkout -b` is
the working creation path today.

Contract sketch: `git branch <name>` creates at HEAD (no switch), duplicate
name → real git's `fatal: a branch named '<name>' already exists` (exit 128);
unsupported flags stay loud `NotImplementedError('git.branch.<flag>')`; RED
first via frozen native fixtures.
