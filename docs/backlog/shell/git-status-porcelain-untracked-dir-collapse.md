---
area: shell
status: draft
title: git status untracked reporting — collapse wholly-untracked directories like native -unormal
created: 2026-08-15
why: rifty prints one `??` row per untracked FILE; native git 2.50.1 default (-unormal) collapses a directory with no tracked content to one `dir/` row
sources: [PR #260 Contract+RED attempt-4 review, https://git-scm.com/docs/git-status]
code: [packages/shell/src/commands/git.ts]
---

## Gap

`git status --porcelain` (and long status) over a tree with an untracked
directory: native git default `-unormal` reports `?? node_modules/` — one row
at the highest wholly-untracked directory; rifty reports every file
(`?? node_modules/a/index.js`, …). Byte-exact fixtures
(`git-fixtures.test.ts`) cover only flat files and dirs with tracked siblings,
so the divergence escaped. Per-file rows also inflate status output on big
dependency trees.

## Contract sketch

- statusMatrix→porcelain shaping collapses untracked rows to the highest
  ancestor directory containing no tracked entry; `-uall`-shaped data stays
  available internally for `add .`-style consumers.
- RED first: frozen native fixture for a wholly-untracked dir (plus a nested
  case) vs rifty CLI bytes; Starter baseline suites keep proving HEAD
  exclusion via the tracked set, never via porcelain shape.
