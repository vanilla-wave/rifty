---
area: shell
status: parked
title: git command + capability over VFS (isomorphic-git)
created: 2026-06-13
why: M12 AI-IDE git-tool + a human shell `git` both need git over the project; rifty has zero git, native git is a spawned binary (browser ceiling) — only faithful path is isomorphic-git over the VFS, and its network transport has a hard CORS/SSH ceiling that must throw loud, never stub
user_story: As a developer at the rifty shell prompt (and the M12 agent's git tool), I want `git status`/`diff`/`add`/`commit`/`log` over my VFS project plus `git clone` of a CORS-reachable repo, but today no git exists anywhere and native git can't be spawned in-browser.
sources: [M12, ADR-0093, ADR-0010, ADR-0005, D-004, docs/backlog/distribution/ai-ide-pi-agent-harness.md, docs/research/open-webcontainers-alternative-2026-06.md, docs/research/rich-terminal-coreutils-2026-06-06.md, "subagent research 2026-06-22 isomorphic-git ceiling verified"]
code: [packages/net/src/http/server.ts, packages/shell/src/builtins.ts, packages/shell/src/commands/grep.ts, packages/npm-client/src/registry.ts, tools/node-parity-runner/]
---

## Context

No git in rifty (nothing imports isomorphic-git / wasm-git). Native git = spawned
binary = browser ceiling. **isomorphic-git** is pure JS over a pluggable `fs` (point
at the rifty VFS) + a pluggable `http` client. Two faithfulness facts (verified vs
isomorphic-git.org docs + repo, 2026-06-22):

- **Local plumbing/porcelain is fully faithful offline** — and it writes **canonical
  git objects**, so a commit with identical `{tree, parent, author, committer,
  message}` (name/email/timestamp/tz-offset) yields the **identical 40-char SHA-1**
  as real git. That equality is the parity anchor.
- **The ceiling is the network.** Smart HTTP/HTTPS is the *only* in-browser
  transport — `ssh://`, `git@host:`, `git://`, dumb-HTTP all unsupported
  (`UnknownTransportError`). Browser same-origin blocks GitHub/GitLab/Bitbucket
  smart-HTTP (they send no CORS headers), so `clone`/`fetch`/`push` need a **CORS
  proxy or a CORS-enabled host**; private/push also need `onAuth` (HTTPS Basic / PAT).
  rifty external egress is host `fetch()` (`packages/net/src/http/server.ts`),
  already CORS-bound — **no bypass exists**. `git clone github` is therefore *not*
  free: gated on an env-config corsProxy, never hardcoded.

Backs a shell `git` command (sibling of grep/find) AND a plain capability API the
M12 Pi agent tool calls directly (a function call, not `spawn('git')`). AI-agnostic,
reusable rifty capability.

## Options or Next

**Placement (pre-resolved direction; ADR to ratify).** New `@riftydev/git`
capability package — the analogue of `npm-client` (orchestrates net transport + vfs
worktree). Arch note: `shell` (tier-3) *may* import `net`/`vfs` (tier-0) top-down —
`arch-rules.cjs` only forbids importing a *higher* tier; extraction is for **SDK
reuse by the out-of-rifty M12 agent**, not an import blocker. A thin shell `git`
command wraps it (`registerCommand`, new `packages/shell/src/commands/git.ts` +
`builtins.ts`), and it is re-exported via the SDK umbrella subpath. New external dep
+ new package + new public subpath = **IRREVERSIBLE → its own ADR**.

**Faithful v1 subset (offline-first, fully real).** `init`, `add`, `rm`, `status
--porcelain`, `commit` (explicit author **and** committer identity+timestamp+tz so
OIDs match canonical git), `log`, `diff` (built from `walk([TREE,WORKDIR,STAGE])` +
a userland line-diff — isomorphic-git has no `diff()`), `checkout`,
`branch`/`listBranches`/`deleteBranch`/`currentBranch`, `tag`/`listTags`,
`resolveRef`, read/write plumbing, `hashBlob`, `get/setConfig`, `listFiles`,
`resetIndex`. Network (gated on corsProxy + onAuth): `clone`/`fetch`/`pull`/`push`,
`getRemoteInfo`, `addRemote`/`listRemotes`; `depth`/`since`/`singleBranch` shallow.

**Loud-throw boundary (`NotImplementedError` + compat ❌, never a stub/empty result):**

- transports `ssh://` / `git@host:` / `git://` / dumb-HTTP → map
  `UnknownTransportError` → `NotImplementedError('git.transport.<x>')`.
- cross-origin smart-HTTP with **no configured corsProxy / non-CORS host** → throw
  naming the CORS ceiling, not a silent network failure/hang.
- push **from a shallow clone** (`GitPushError`) → surface loud, no silent retry.
- large-repo in-memory packfile OOM → loud error, not a hang.
- GPG commit signing (`user.signingkey` / `commit.gpgsign`) → throw (never silently
  land unsigned).
- exotic plumbing: rebase, `pull --rebase`, submodules, worktrees, sparse-checkout,
  partial/`--filter` clone, gc/repack/prune, reflog, bisect, blame, hooks,
  clean/smudge & `.gitattributes` filters → throw.

**Pre-resolved decisions (no deferral):**

- corsProxy base URL = env-config via the **D-004 tiered pattern** (mirror npm
  registry, `packages/npm-client/src/registry.ts`); **never** a hardcoded URL; unset
  default → cross-origin clone throws the CORS-ceiling error. Do **not** bake
  `cors.isomorphic-git.org` (test-only / unreliable).
- git `http` client backed by **rifty egress** (`packages/net/src/http/server.ts`
  host `fetch`) so routing/behavior matches `node:http`, not isomorphic-git's stock
  web client. Pluggable-fetcher precedent: `RegistryClient` ctor (`registry.ts`).
- `onAuth` wired to an injectable token provider (HTTPS Basic / PAT); credential
  persistence is decided in the ADR, not deferred.
- commit determinism: author **and** committer identity+timestamp+tz are explicit
  inputs (no implicit "now") so SHAs reproduce.

**Acceptance (honest contract — all land together, no partial merge):**

- offline porcelain (`init`→`add`→`commit`→`status`→`log`→`diff`→`checkout`→`branch`)
  works over a real Memory VFS, no network.
- a pinned-input commit yields the **same 40-char SHA-1** as canonical git (frozen
  reference) — proves object fidelity.
- every boundary above throws a directed `NotImplementedError` (asserted), not a
  stub/empty result.
- `clone` of a CORS-reachable test repo works through the env-config corsProxy;
  `clone` of GitHub **without** a proxy throws the CORS-ceiling error (asserted).
- both the shell `git` command and the plain capability API are exercised; compat
  matrix updated (✅ the subset, ❌ every thrown boundary).
- the ADR (new dep + package + subpath + corsProxy/onAuth contract) recorded with
  implementation.

**Parity oracle (ADR-0093 tiers — NOT live host-spawn).** ADR-0093(a) rejects a live
`git` spawn as gold (non-deterministic across boxes; and the parity-runner cannot
spawn non-`node` binaries — execSync rejects non-`node`). So: (b) **frozen golden
fixtures** from a pinned git (LC_ALL=C, version+locale header) capture reference
`status --porcelain` / `log` / unified-diff bytes + the canonical commit SHA for
fixed inputs; assert isomorphic-git reproduces byte-identical (mirrors ls-vs-gls,
`packages/shell/fixtures/ls/`). Deterministic **commit-SHA equality** is the
strongest anchor. Record honestly (as grep/find do when ggrep/gfind are absent)
wherever a fixture can't be captured on the box — no silent cap.

## Reversibility

- This backlog doc: **REVERSIBLE**.
- Implementation: **IRREVERSIBLE** — new external dep (isomorphic-git), new
  `@riftydev/git` package + public subpath, and a public corsProxy/onAuth contract;
  intersects ADR-0010 (https egress) + D-004. Needs its own ADR. Gated on M12.
