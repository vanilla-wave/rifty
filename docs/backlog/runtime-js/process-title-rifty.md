---
area: runtime-js
status: draft
title: process.title is 'rifty' where Node reports 'node'
created: 2026-11-23
why: Found by the external review of the isolate sandbox (PR #419).
sources: [PR-419-external-review]
code: [packages/runtime-js/src/builtins/process-identity.ts]
---

## Context

Probe 2026-11-23: `console.log(process.title)` — Node v24.16.0 started as `node` gives `node` (argv[0] as invoked: the full path when started by path), a
sandbox `exec` (and `runCode`) `rifty` (`NODE_PROCESS_IDENTITY.title`). Part of
the identity ceiling (compat `isolate-host.md` "Identity: process.version …
rifty's"), but `title` is not named there. Decide: name it in that row, or
report Node's value.

## Challenge

challenge: 2026-11-23 — none yet (factual capture)
