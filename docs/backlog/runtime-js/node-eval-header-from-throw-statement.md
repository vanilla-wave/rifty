---
area: runtime-js
status: draft
title: "The `-e` report header never names a throw statement JS cannot prove"
created: 2026-11-22
why: the eval projection snaps the header to the innermost `throw` around the error's frame (a rethrown or kept error names the wrong line), the class the file path removed
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Pre-existing on main; the file-entry report prints no synchronous header since 2026-11-22 (ADR-0445 line), the `-e` projection still does. Found by the PR #421 external review (round 1, Node v24.16.0), not in the corpus of
ADR-0571; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
