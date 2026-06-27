---
area: shell
status: draft
title: git command + capability over VFS (isomorphic-git)
created: 2026-06-13
closed: 2026-06-22
why: @riftydev/git over the VFS, shell `git`, offline-faithful porcelain (commit-SHA == canonical git), smart-HTTP network + corsProxy/onAuth, and the achievable agent/dev porcelain cluster are landed. Remaining absences are explicit compat ceilings, never silent stubs.
user_story: As a developer at the rifty shell prompt (and the M12 agent's git tool), I want real git local workflow over my VFS project plus smart-HTTP clone/fetch/pull/push for reachable repos. DELIVERED to the current browser/VFS hard ceiling.
sources: [M12, ADR-0167, ADR-0093, ADR-0010, ADR-0005, D-004, docs/backlog/distribution/ai-ide-pi-agent-harness.md, docs/public/compat/git.md]
code: [packages/git/src/git.ts, packages/git/src/fs-adapter.ts, packages/git/src/http-plugin.ts, packages/shell/src/commands/git.ts]
---

## Status — CLOSED

Shipped as `@riftydev/git` (tier-0) + a shell `git` builtin + SDK `@riftydev/sdk/git`:

- **Offline porcelain, faithful where claimed:** init/add/remove/status/commit/log/diff/branch/checkout/switch/restore/config/reset/show/tag/remote/merge/stash/cherry-pick/rm/mv over the VFS. `checkout`/`switch` branch paths keep frozen real-git stderr fixtures; commit SHA is byte-identical to canonical git for fixed identity/date inputs (`commit-sha-parity.test.ts`).
- **Byte-exact conformance** vs real git 2.50.1 (frozen golden fixtures): `status --porcelain`, `log --oneline` (`packages/git/fixtures/`, `git-fixtures.test.ts`).
- **Adversarial hard-ceil pass (2026-06-23):** regression-locked `diff HEAD <path>` and `--cached` unborn-HEAD behavior, `log -- <path>`, `reset --hard` removing tracked paths absent from the target tree, `show <commit>` patch output, `stash@{n}` selection, loud `stash -u` ceiling, `ls-remote <remote>` config resolution, and `rm`/`mv` data-loss guards.
- **Diff/reset/revspec/subdirs:** bare/staged/HEAD/one-ref/two-ref diff pick the correct trees; pathspecs work with or without `--`; cwd-relative pathspecs from repo subdirectories are translated to repo-root paths; parent revspec arithmetic (`HEAD~n`, `^`, `^0`) is parsed centrally; reset supports path unstage plus soft/mixed/hard HEAD movement. Diff hunks remain structured LCS output, not byte-exact long-form git diff text; compat marks that ⚠️.
- **Network (smart-HTTP):** clone/fetch/pull/push/ls-remote over rifty net egress; `ls-remote` accepts a URL or configured remote name. Real `git http-backend` clone integration-tested end-to-end (`network.integration.test.ts`). corsProxy via D-004 env-config (`RIFTY_GIT_CORS_PROXY`), `onAuth` token provider.
- **Loud-throw ceiling:** ssh/`git://`/dumb-HTTP → `NotImplementedError('git.transport.*')`; cross-origin-without-proxy → `git.cors` (browser); unimplemented git subcommands → loud exit-128. Compat: `docs/public/compat/git.md`.

## Current hard ceilings

These are not silent backlog placeholders. They are explicit public non-claims in `docs/public/compat/git.md`:

- Browser transport ceilings: SSH/scp-like, raw `git://`, dumb HTTP, cross-origin smart HTTP without configured CORS proxy.
- VFS representation ceilings: exec-bit/symlink tree-SHA fidelity, CRLF/`.gitattributes` clean-smudge filters, GPG signing, hooks/gc/repack/fsck. Follow-up: `docs/backlog/vfs/git-vfs-fidelity-exec-symlink-attributes.md`.
- isomorphic-git stash ceiling: tracked files only; `stash -u`/`--include-untracked`/`--all` loud-throw `git.stash.include-untracked`.
- Scope ceilings: reflog-dependent syntax (`@{-1}`, `HEAD@{1}`), config value-pattern/multi-value forms, conflict continue/abort, `apply`/`am` patch-mailbox workflows, rebase/revert/submodules/worktrees/sparse/partial clone/bisect/blame. Follow-up: `docs/backlog/shell/git-state-workflows-reflog-conflicts-patches.md`.

## Test evidence

- `packages/git/tests/*`
- `packages/shell/tests/git-cli.test.ts`
- `packages/shell/tests/git-fixtures.test.ts`
- `docs/public/compat/git.md`

## Reversibility

- Core capability is **IRREVERSIBLE** and recorded in ADR-0167 (new dep isomorphic-git, `@riftydev/git` package + SDK git subpath, corsProxy/onAuth contract).
- This backlog item is closed; compat rows are the source of truth for remaining explicit non-claims.
