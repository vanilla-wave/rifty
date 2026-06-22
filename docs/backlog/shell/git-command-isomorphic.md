---
area: shell
status: parked
title: git command + capability over VFS (isomorphic-git)
created: 2026-06-13
why: v1 core LANDED (ADR-0167) — @riftydev/git over the VFS, shell `git`, offline-faithful porcelain (commit-SHA == canonical git), smart-HTTP network + corsProxy/onAuth, loud-throw ceiling, compat git.md. This item now tracks the deferred post-v1 fidelity-hardening residuals.
user_story: As a developer at the rifty shell prompt (and the M12 agent's git tool), I want `git status`/`diff`/`add`/`commit`/`log` over my VFS project plus `git clone` of a CORS-reachable repo — DELIVERED in v1; the residuals below harden fidelity for repos that rely on exec-bits/symlinks/CRLF or are large.
sources: [M12, ADR-0167, ADR-0093, ADR-0010, ADR-0005, D-004, docs/backlog/distribution/ai-ide-pi-agent-harness.md, docs/public/compat/git.md]
code: [packages/git/src/git.ts, packages/git/src/fs-adapter.ts, packages/git/src/http-plugin.ts, packages/shell/src/commands/git.ts]
---

## Status — v1 core LANDED (ADR-0167)

Shipped as `@riftydev/git` (tier-0) + a shell `git` builtin + SDK `@riftydev/sdk/git`:

- **Offline porcelain, fully faithful:** init/add/remove/status/commit/log/diff/branch/checkout/resolveRef over the VFS. `checkout` = branch-switch (existing/`-b`/detached HEAD) + file-restore (from index or a tree-ish), byte-exact stderr vs git 2.50.1 (`checkout-*` fixtures, `checkout.test.ts`). **commit-SHA is byte-identical to canonical git** (`commit-sha-parity.test.ts`). (`config` is NOT a delivered porcelain verb — it loud-throws, see below.)
- **Byte-exact conformance** vs real git 2.50.1 (frozen golden fixtures): `status --porcelain`, `log --oneline` (`packages/git/fixtures/`, `git-fixtures.test.ts`).
- **Network (smart-HTTP):** clone/fetch/pull/push over rifty net egress; real `git http-backend` clone integration-tested end-to-end (`network.integration.test.ts`). corsProxy via D-004 env-config (`RIFTY_GIT_CORS_PROXY`), `onAuth` token provider.
- **Loud-throw ceiling:** ssh/`git://`/dumb-HTTP → `NotImplementedError('git.transport.*')`; cross-origin-without-proxy → `git.cors` (browser); unimplemented git subcommands → loud exit-128. Compat: `docs/public/compat/git.md`.

## Remaining follow-ups (deferred, post-v1)

Each is a genuine fidelity gap, **recorded loud** (compat ❌ + note), never a silent stub:

- **CRLF / `.gitattributes` / clean-smudge filters.** No line-ending normalization → a SHA-divergence source for repos that rely on `text=auto`/`core.autocrlf`. Needs a filter layer; until then commits of such files diverge from canonical git (documented).
- **Exec-bit + symlinks (tree-SHA fidelity).** The VFS has no POSIX mode/symlink layer (ADR-0050) → file mode is fixed `100644`, so repos with executable files or symlinks diverge in tree-SHA. Gated on a VFS mode/symlink layer (ADR-0050 follow-up).
- **Push-from-shallow hardening.** isomorphic-git can't push from a shallow clone (`GitPushError`); currently surfaced loud — a deepen-then-push path is future work.
- **Large-repo packfile streaming.** isomorphic-git buffers packfiles in memory → OOM on large repos; default singleBranch+depth mitigates. Streaming parse is future work.
- **Long-format byte-exactness.** Default `git status` / `git log` / `git diff` are human-readable (not byte-exact git); `diff` is structured hunks, not byte-exact `git diff` text. Byte-exact long formats deferred.
- **`checkout` ceilings.** `--orphan` / `-B` / `--patch` / `--merge` / `--ours`·`--theirs` / `--track` / `checkout -` (previous branch, needs reflog `@{-1}`) / glob-magic pathspecs / `-q` / revspec arithmetic (`HEAD~1`/`main^`/`@{-1}`/`HEAD@{1}` → `git.checkout.revspec`, iso-git resolveRef can't parse it) all loud-throw `NotImplementedError('git.checkout.<x>')` (exit 128). The genuine 2-arg `<revision> <path>` ambiguity refusal (`checkout dev dev` where `dev` is both a branch and a tracked file) is DEFERRED — single-arg follows git's branch precedence (ref wins), but the rare 2-arg ambiguous case is not yet rejected. `git restore` / `git switch` remain separate unimplemented commands (the detached-HEAD advisory still quotes git's verbatim `git switch` hint — fidelity to git's text).
- **Broader iso-git surface.** tag/stash/merge/cherry-pick/reset/remote/config-CLI etc. are not in the v1 subset (the shell reports them as not-implemented, exit 128).

## Reversibility

- v1 core: landed, **IRREVERSIBLE** — recorded in ADR-0167 (new dep isomorphic-git, `@riftydev/git` package + `@riftydev/sdk/git` subpath, corsProxy/onAuth contract).
- Residuals above: **REVERSIBLE** (this doc); each takes its own ADR/backlog when picked up. Parked until a user scenario needs them.
