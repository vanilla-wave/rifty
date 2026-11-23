---
area: runtime-js
status: draft
title: "`require.resolve.paths` and `module.require` exist as in Node"
created: 2026-11-22
why: both are absent on rifty's CJS require/module
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Node: `require.resolve.paths(request)` lists the lookup dirs, `module.require(id)` requires relative to the module. Found by the PR #421 external review (round 1, Node v24.16.0), outside goal
`node-file-entry-parity`; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
