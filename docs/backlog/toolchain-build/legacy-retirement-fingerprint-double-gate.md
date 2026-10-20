---
area: toolchain-build
status: draft
title: Any runtime-js edit turns the first pr:check red on the typescript-worker fingerprint, forcing a refresh commit and a second full gate
created: 2026-10-20
why: observed in the 2026-10-20 bench run — 5 "Refresh typescript-worker fingerprint" commits, IMPLEMENT ran pr:check twice in 5 of 6 units (≈45 min of gate time per run)
sources: [rifty-bench result 2026-10-19-claude-opus-5.5-process-v3-workflow, docs/process/traps.md §Harness claude-goal-run]
code: [tools/checks/esbuild-legacy-retirement.mjs, tools/checks/pr-check.mjs]
---

## Context

`check:esbuild-legacy-retirement` pins the built `typescript-worker.js`
fingerprint; any `packages/runtime-js` change invalidates it, the first
`pnpm pr:check` on the committed product change exits 1 on that check alone,
the driver commits "Refresh typescript-worker fingerprint" and re-runs the whole
diff-scoped gate (5–8 min). The retirement guard is right to pin the artifact;
the cost is the second full run for a pin the first run already proved stale.

## Challenge

challenge: pending — premise check at PICKUP (`RDY-2`)

## User scenario

A maintainer edits `packages/runtime-js/src/builtins/path.ts`, commits, runs
`pnpm pr:check` once: the fingerprint pin is refreshed (or reported) in that
run, and the gate is green on the same tree without a second full pass.
