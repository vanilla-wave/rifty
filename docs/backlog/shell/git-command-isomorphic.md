---
area: shell
status: parked
title: git command + capability over VFS (isomorphic-git)
created: 2026-06-13
why: M12 AI-IDE wants git-aware agent tools (status/diff/commit) and a human `git` command; rifty has no git anywhere, and native git is a spawned binary (browser ceiling)
user_story: As a developer at the rifty shell prompt, I want `git status`/`git diff`/`git commit`/`git clone` over my VFS project, but today no git exists anywhere and native git can't be spawned in-browser.
sources: [M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/shell/grep-find-frozen-gnu-fixtures.md]
---

## Context

No git in rifty (nothing imports isomorphic-git / wasm-git). Native git is a spawned
binary — a browser ceiling. isomorphic-git is pure JS over an fs interface; point it
at the rifty VFS. Backs a shell `git` command (sibling to grep/find) AND a plain API
the M12 agent's git tool calls directly (a function call, not `spawn('git')`).
AI-agnostic — a reusable rifty capability.

## Options or Next

- isomorphic-git over the VFS: clone (fetch transport), status, add, commit, diff, log.
- Expose as a `shell` command + a plain API for the agent binding.
- Common subset first; defer exotic plumbing (rebase, submodules, …).

## Reversibility

IRREVERSIBLE when taken up — new external dep (isomorphic-git). Needs its own ADR.
