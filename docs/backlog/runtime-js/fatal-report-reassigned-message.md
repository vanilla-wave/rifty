---
area: runtime-js
status: draft
title: "A fatal report of an error whose message changed after construction prints Node's text"
created: 2026-11-22
why: `err.message = 'new'; throw err` prints the old message (the captured stack header) where Node prints the new one
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/builtins/fatal-report.ts]
---

## Context

Node's inspect rebuilds the header when `message` is no longer in `stack`; rifty prints `stack` as captured. Found by the PR #421 external review (round 1, Node v24.16.0), outside goal
`node-file-entry-parity`; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
