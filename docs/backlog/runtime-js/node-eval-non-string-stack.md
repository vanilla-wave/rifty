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

`projectNodeEvalError` reads `stack` as a string. Found by the PR #421 external review (round 1, Node v24.16.0), not in the corpus of
ADR-0571; not reproduced by this capture beyond the reviewer's run.

Same seam, internal review round 2 (PR #421, probe H4, isolate `-e` rows): an
error whose `stack` getter throws reports the getter's own error instead of the
program's — `projectNodeEvalError` reads `stack` before the fatal formatter
(which prints Node's `name: message` + `--trace-uncaught` hint for it, row
`error-throwing-stack-getter` on `node <file>`). Closed in PR #425: with the
isolate's report installed the projection reads `stack` guarded and leaves
such an error to the report (row equals Node in the isolate). Open: a
non-string `stack` (`e.stack = 42`) on the `-e` path; the number of reads: an
own `stack` getter runs 3 times in the isolate before the report prints, 4 in
Node (PR #425 Final probe, a required file and a top-level `-e` throw).
Owner: runtime-js (eval projection, fatal report). Trigger: a guest whose
`stack` getter has effects, or the next change to the projection.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
