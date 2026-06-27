---
area: shell
status: draft
title: git state workflows: reflog, conflicts, advanced revert/apply
created: 2026-06-23
why: The local git surface now covers clean agent workflows, including clean revert/apply, but stateful recovery and conflict workflows need a real git-state layer, not one-off porcelain flags.
user_story: As a developer or agent working in rifty, I want to recover prior refs, resolve merge/cherry-pick conflicts, and apply/revert patches with real git state semantics.
sources: [ADR-0167, docs/public/compat/git.md, docs/backlog/shell/git-command-isomorphic.md]
code: [packages/git/src/git.ts, packages/shell/src/commands/git.ts]
---

## Contract

Implement only when the state model is real and parity-tested:

- Reflog: write/read `.git/logs/HEAD` and branch logs for rifty-owned ref moves; support `@{-1}` and `HEAD@{n}` where the log exists.
- Conflict state: create/read/clear `MERGE_HEAD`, `CHERRY_PICK_HEAD`, conflict markers, and index conflict stages; support `merge --continue|--abort` and `cherry-pick --continue|--abort`.
- Advanced patch workflows: conflict-aware `git apply`, `git apply --3way`/`--index`/`--cached`/`--check`, binary/rename/copy/mode patches, mailbox `git am`, and conflict-aware `git revert` using the same state layer.

## Delivered Boundary

- `git revert <commit>` supports the clean single-parent case only: clean worktree, touched paths still match the reverted commit's post-image, then an inverse `Revert "<subject>"` commit is written. Dirty worktrees, merge commits/mainline, multiple commits, `--no-commit`, sequencer modes, and content conflicts throw directed `NotImplementedError('git.revert.<x>')` before mutation.
- `git apply <patch-file>` / `git apply -` supports clean text unified diffs for add/modify/delete hunks against the VFS worktree, all-or-nothing. Unsupported patch modes/features throw directed `NotImplementedError('git.apply.<x>')`; context conflicts leave every file untouched.

## Non-Negotiables

- No fake conflict success: unresolved conflicts must block commit/continue exactly where real git would.
- No best-effort patch applier: unsupported patch features loud-throw with a specific `NotImplementedError`.
- No hidden reflog gaps: unsupported reflog syntax remains a directed ceiling until backed by real log entries.

## Acceptance

- Frozen real-git fixtures for stderr/stdout around conflict start/continue/abort.
- State assertions over real Memory VFS files (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `.git/logs/*`).
- RED tests proving unsupported patch/reflog forms do not silently succeed.
