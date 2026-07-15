---
area: toolchain-build
status: draft
title: Migrate GitHub Actions off the deprecated Node 20 action runtime
created: 2026-07-15
why: GitHub already forces several pinned action releases onto Node 24 and warns that their declared Node 20 runtime is deprecated
user_story: As a maintainer, I want CI actions to declare a supported runtime, but today every workflow emits a forward-compatibility warning whose forced fallback may be removed
sources: [https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/]
code: [.github/workflows/ci.yml, .github/workflows/netlify.yml, .github/workflows/ci-cross-browser.yml, .github/workflows/release.yml]
---

## Context

PR #145's exact-SHA Netlify run reported that `actions/checkout@v4`,
`actions/setup-node@v4`, and `pnpm/action-setup@v4` still target the deprecated
Node 20 action runtime and are being forced onto Node 24 by GitHub. The jobs
remain green, so this is unrelated to Workbench behavior. Inventory every
workflow occurrence, select releases that natively target a supported action
runtime, and verify all CI/release/deploy paths before the forced compatibility
mode is removed.
