---
area: playground
status: ready
title: SCM actions — stage/unstage/discard/commit from the panel (owner-acked)
created: 2026-06-27
why: Graphical stage/commit closes the SCM loop; commit must produce a byte-identical canonical SHA and staging is index state that lives only in the owner .git.
user_story: As a dev, I want to stage files, write a message, and commit with Cmd+Enter from the panel, but today I must compose git add/commit in the terminal and the page cannot touch the index.
epic: scm-file-manager
blocked_by: [playground/git-owner-rpc-channel, playground/scm-readonly-panel]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/git-owner-rpc-channel.md, docs/backlog/playground/scm-readonly-panel.md, ADR-0148, ADR-0165, ADR-0167, docs/public/compat/git.md]
code: [apps/playground/src/glue/realVite.ts, packages/git/src/git.ts, packages/shell/src/commands/git.ts]
---

## Context

Staging is index state in the owner `.git` — it cannot be reconstructed page-side.
Actions are owner verbs over the git-RPC channel (request/reply gives ack), then
the status feed refreshes. `commit()` is parity-proven SHA-identical; author
identity reuses the shell's resolution (`GIT_AUTHOR_*` → `user.name`/`user.email`
config → default).

## Scope

- **In:** page→owner git-action calls over the RPC channel: stage=`add`,
  unstage=`unstage`/`restore --staged`, discard=`checkout`/`restore`, commit=
  `add`+`commit`; an SCM input box + Cmd/Ctrl+Enter; config-resolved identity;
  refresh the status feed on ack (ideally trigger an immediate re-emit to avoid
  the 1.5s lag).
- **Out:** conflict resolution UI (forbidden — see guardrails); remote push/pull.

## Guardrails

- **Owner-acked, not optimistic** — the page SCM model is a pure projection of
  owner-acked state; never mutate index/working state page-side.
- An action during the owner-respawn window fails LOUDLY (mirror `writeFile`
  "owner has exited"), never silent-drops.
- **Conflicts:** `merge()`/`cherryPick()` bare-delegate to isomorphic-git; a
  conflict surfaces the engine's loud iso-git/shell-classified throw — NOT a
  fabricated `NotImplementedError` and NOT a half-wired conflict/merge UI. Do not
  wrap it into a swallowing path.

## Acceptance

- Parity: a commit from the panel produces a SHA byte-identical to shell `git
  commit` for identical inputs; stage/unstage/discard reflect on the next feed
  tick; an action in the respawn window fails loudly.

## Parity cases

- A commit from the panel produces a SHA byte-identical to shell `git commit` for
  identical inputs (tree, message, author, parents) — already engine-proven.
- stage=`add`, unstage=`unstage`/`restore --staged`, discard=`checkout`/`restore`
  each reflect on the next feed tick (or an immediate re-emit), matching the
  engine's resulting `status()`.
- Author identity resolves `GIT_AUTHOR_*` → `user.name`/`user.email` config →
  default, matching the shell `git` builtin.

## Out of scope

- Conflict-resolution / 3-way merge UI → NOT built; a `merge()`/`cherryPick()`
  conflict surfaces the engine's loud iso-git/shell-classified throw — never a
  fabricated `NotImplementedError` and never a half-wired merge UI / swallow.
- Remote push/pull/fetch → out (epic out-of-scope).
- GPG-signed commits → engine ceiling, compat ❌, not offered.

## Decisions

- Actions are owner verbs over the git-RPC channel (request/reply ack), then refresh
  the feed (ideally an immediate re-emit to beat the 1.5s lag).
- Owner-acked, NOT optimistic — the page SCM model is a pure projection of
  owner-acked state.
- An action in the owner-respawn window fails loudly. Extends the git-RPC action
  surface → CHANGELOG line (rides the channel's reversibility), no separate ADR.

## Reversibility

IRREVERSIBLE on merge only as far as it extends the git-RPC action surface
(CHANGELOG line; the wire shape rides `git-owner-rpc-channel`'s ADR if any). The
panel UI is REVERSIBLE.
