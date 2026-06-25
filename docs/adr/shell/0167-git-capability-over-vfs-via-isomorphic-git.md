# ADR 0167: git capability over VFS via isomorphic-git

Status: Proposed
Date: 2026-06

> TL;DR: new tier-0 `@riftydev/git` wraps **isomorphic-git** over the VFS — offline porcelain fully faithful (canonical objects → identical SHA-1), network is smart-HTTP-only via rifty egress + a D-004 env-config corsProxy, and every browser-ceiling gap throws `NotImplementedError` (never a silent stub).

## Context

M12 (AI-IDE) needs a git tool (status/diff/commit/log, clone) and a human shell wants `git`; rifty has zero git. Native git is a spawned binary — a browser ceiling. The only faithful path is **isomorphic-git** (pure JS over a pluggable `fs` + pluggable `http`), pointed at the rifty VFS. Spec: `docs/backlog/shell/git-command-isomorphic.md`. Verified ceiling (isomorphic-git.org docs + repo, 2026-06-22; 4 critical facts adversarially confirmed): local plumbing is fully faithful and writes **canonical git objects** (identical SHA for identical inputs); the network is the ceiling — smart-HTTP only (no SSH/`git://`/dumb-HTTP), browser same-origin blocks GitHub/GitLab/Bitbucket smart-HTTP (no CORS) so clone/fetch/push need a CORS proxy or CORS-enabled host, and push/private need `onAuth` (HTTPS Basic / PAT). New external dep + new package + new public subpath = IRREVERSIBLE → this ADR.

## Decision

- **Dependency + package.** Add `isomorphic-git`. New package `@riftydev/git`, placed **tier-0** (`tools/checks/arch-rules.cjs` `TIERS[0] += 'git'`) so `shell`(tier-3)→`git` is strictly top-down and `git`→`vfs`/`net` is same-tier (precedent: `net`→`io`). Public via the SDK umbrella subpath `@riftydev/sdk/git`. Two consumer shapes: a shell `git` command + a plain `makeGit()` API the M12 agent calls directly (function call, not `spawn`). AI-agnostic, reusable.
- **fs adapter.** A VFS→isomorphic-git `fs` adapter synthesizes the POSIX stat fields the VFS lacks (`mode`,`ino`,`ctimeMs`,`uid`,`gid`,`dev`, `isFile()/isDirectory()/isSymbolicLink()` methods). **Honest limitation (sibling of ADR-0050):** the VFS has no symlink layer and no exec-bit, so file mode is always `100644` — `100755`/symlink tree entries are not representable, so the tree-SHA (and thus commit-SHA) diverges from canonical git for repos containing executable files or symlinks. `readlink`/`symlink` throw; `chmod` is a no-op. Recorded loud (compat ❌ + note), never silently wrong.
- **Transport.** The isomorphic-git `http` plugin is backed by `@riftydev/net` egress (`http.request` → host `fetch` for external `https:`), so git egress shares `node:http` routing — NOT isomorphic-git's stock web client.
- **corsProxy.** D-004 env-config (`RIFTY_GIT_CORS_PROXY`, tiered like the npm registry URL), never hardcoded; unset default → a cross-origin clone throws the directed CORS-ceiling error. Do not bake `cors.isomorphic-git.org` (test-only / unreliable).
- **Auth.** `onAuth` = an injected token provider (HTTPS Basic / PAT). v1 does not persist credentials (no store).
- **Commit determinism.** Author AND committer identity+timestamp+timezone-offset are explicit inputs (no implicit "now") so SHAs reproduce.
- **Loud-throw boundary** (`NotImplementedError`, compat ❌, never stub): `ssh://`/`git@host:`/`git://`/dumb-HTTP transports; cross-origin smart-HTTP with no configured corsProxy/CORS-host; push from a shallow clone; in-memory packfile OOM (loud error, not a hang); GPG commit signing; rebase, `pull --rebase`, submodules, worktrees, sparse-checkout, partial/`--filter` clone, gc/repack/prune, reflog, bisect, blame, hooks, clean/smudge & `.gitattributes` filters.
- **Parity oracle.** ADR-0093 tier-b: **frozen real-git golden fixtures** (pinned git, `LC_ALL=C`, provenance header — like `fixtures/ls/` vs `gls`) + **deterministic commit-SHA equality** against a canonical value computed once by real git. A live `git` spawn as oracle is rejected (ADR-0093(a); the parity-runner also cannot spawn non-`node` binaries).

## Consequences

- M12 agent git-tool + human shell `git` unblocked over the VFS, faithful to real git for the offline porcelain (byte-identical objects/SHA).
- Phased delivery: offline-faithful core first (network verbs loud-throw), then network (egress http + corsProxy + clone/fetch/pull/push), then closeout (compat matrix, gate) — each phase mergeable, no silent stub.
- Network reachability is bounded by browser physics: no SSH; GitHub/GitLab/Bitbucket need a corsProxy or PAT. Honest throws, not approximations (StackBlitz/WebContainers hit the same ceiling).
- New caveat surfaced: VFS lacking exec-bit/symlink → tree-SHA divergence for such repos (compat ❌ + note); a future VFS mode/symlink layer (ADR-0050 follow-up) would close it.
- New external dep (`isomorphic-git`) enters the supply chain; pinned + lockfile audited against the npmjs.org registry.
- Follow-ups (as backlog, not silent TODO): CRLF/`.gitattributes` normalization (a known SHA-divergence source), push hardening, large-repo streaming.
