---
area: toolchain-build
status: draft
title: Repo checks exit 0 without checking when run through a symlinked path
created: 2026-11-26
why: 12 of 17 `tools/checks/*.mjs` gate `main` on `process.argv[1] === fileURLToPath(import.meta.url)`; through a symlinked path the two differ, nothing runs and the process exits 0 — a green that checked nothing.
sources: [PR #465 review 2026-11-26]
code: [tools/checks/lockfile-registry.mjs, tools/checks/file-size.mjs, tools/checks/pr-check.mjs]
---

## Context

Finding. Node resolves the main module to its real path (`import.meta.url`)
but keeps the symlinked path in `process.argv[1]` (no `--preserve-symlinks-main`).
Repro 2026-11-26, Node v24.16.0, macOS:

```
ln -s "$PWD" /tmp/lk-sym
node /tmp/lk-sym/tools/checks/lockfile-registry.mjs; echo $?   # no output, 0
node "$PWD/tools/checks/lockfile-registry.mjs"                  # ✓ lockfile-registry: 44 lock carrier(s) …
```

Same on macOS for any path under `/tmp` (→ `/private/tmp`). Affected: all 12
with that guard. The other five: `ci-gate.mjs:61` already guards with
`realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` (runs
through the symlink); `check-arch`, `client-bundle-budget`, `parity-coverage`,
`sync-sha256-cores` have no guard and always run. Not affected
today: `pnpm check:*` and CI run them by repo-relative path from the checkout.
Who hits it: an agent or script invoking a check by absolute path from a
symlinked worktree or `/tmp` copy reads exit 0 as green.

## Question

One shared entry guard for the checks (compare real paths) versus a different
invocation contract — and whether a check run that did not execute must fail
loudly rather than exit 0.
