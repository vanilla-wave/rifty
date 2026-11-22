---
area: runtime-js
status: draft
title: "A CommonJS file starting with a BOM then a shebang fails to compile as in Node"
created: 2026-11-22
why: a BOM followed by `#!` runs in rifty; Node throws SyntaxError
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Node strips the BOM, then a hashbang is only valid at offset 0; rifty strips both. Found by the PR #421 external review (round 1, Node v24.16.0), outside goal
`node-file-entry-parity`; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
