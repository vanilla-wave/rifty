---
area: playground
status: draft
title: Remove or differentiate synthetic Vite watcher changes
created: 2026-06-26
why: synthetic watcher tracking has no observable effect because both watcher branches publish the same snapshot.
user_story: As a playground maintainer, I want watcher invalidation code to express real behavior, but today the synthetic change set looks meaningful while both branches do the same thing.
sources: [PR76 review C5]
code: [apps/playground/src/workers/dev-server-boot.ts]
---

## Context

`handleViteFileChange` records synthetic module paths in `syntheticWatcherChanges`, but the watcher `change` handler calls `publishSnapshot()` for both synthetic and fall-through paths. The set is dead machinery unless the branches diverge.

## Options or Next

Either remove `syntheticWatcherChanges` entirely or make the synthetic branch perform a distinct, documented action. Add a regression around watcher changes if the branch remains.

## Reversibility

REVERSIBLE — cleanup or small behavior clarification in playground worker code, recorded here.
