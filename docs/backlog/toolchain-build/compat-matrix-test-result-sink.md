---
area: toolchain-build
status: draft
title: Feed compat matrices from test results instead of static inventories
created: 2026-06-13
why: cli.js holds hand-curated ✅/⚠️/❌ rows and only validates that cited test FILES exist — a row stays ✅ even if its test is skipped or gutted, so claims can silently drift from test outcomes
user_story: As a rifty maintainer trusting the fs/streams/http compat matrices, I want a row's ✅/⚠️/❌ to derive from its cited tests' actual pass/skip state, but today `compat:generate` only checks the test file exists so a gutted or skipped test still renders ✅.
sources: ["PR #26 review", docs/public/compat/README.md]
code: [tools/compat-matrix-generator/cli.js]
---

## Context

`pnpm compat:generate` renders `docs/public/compat/{fs,streams,http}.md` from
static row arrays inside `cli.js`. `validateMatrixSources` checks the cited
conformance/parity FILES exist, not that they pass or still assert the claimed
behavior. CLAUDE.md's verification philosophy says the matrix is auto-generated
from test results; the static skeleton was a deliberate milestone-close
shortcut (disclosed in the generated pages) and this item is the promised
follow-up.

## Options or Next

- Vitest JSON reporter run (`vitest run --reporter=json`) + parity runner JSON
  output → map test ids to matrix rows; a row's status derives from its tests'
  pass/skip state, notes stay hand-written.
- Minimum bar: fail `compat:generate` when a cited test file no longer contains
  the cited test name (string match), closing the gutted-test drift hole
  cheaply.

## Reversibility

REVERSIBLE — generator internals; the public page format is unchanged.
