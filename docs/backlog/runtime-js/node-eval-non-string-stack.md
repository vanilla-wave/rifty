---
area: runtime-js
status: draft
title: "`node -e` with a non-string `stack` on the thrown error prints Node's report"
created: 2026-11-22
why: `e.stack = 42; throw e` in `-e` prints rifty's own source (loader.ts projection)
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/module-loader/loader.ts]
---

## Context

`projectNodeEvalError` reads `stack` as a string. Found by the PR #421 external review (round 1, Node v24.16.0), outside goal
`node-file-entry-parity`; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
