---
area: runtime-js
status: draft
title: "Deleting the loading module from `require.cache` makes a later require run it again"
created: 2026-11-22
why: `delete require.cache[__filename]` during the module's own evaluation does not re-execute it on the next require
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

`executeCjs` reloads only a deleted *loaded* record; a loading one is returned as is. Found by the PR #421 external review (round 1, Node v24.16.0), outside the scope of
ADR-0571; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
