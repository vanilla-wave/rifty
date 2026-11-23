---
area: runtime-js
status: draft
title: Callback `fs.appendFile` and `fs.rm` are missing
created: 2026-11-23
why: `fs.appendFile` and `fs.rm` are `undefined` — a call is `TypeError: fs.appendFile is not a function` — while their sync and `fs.promises` forms exist; Node has both callback forms.
sources: [docs/public/compat/fs.md, PR-424-cross-review]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Found by the PR #424 cross-review (round 2) in the isolate host's guest; `typeof fs.appendFile`
and `typeof fs.rm` are `'undefined'` there, the other callback members tested are functions
(`writeFile`, `unlink`, `mkdir`, `rename`, `copyFile`, `readdir`, `stat`). A program written for
Node fails with a `TypeError` instead of the named gap or the call. Owner: runtime-js. Trigger:
the next `node:fs` surface change, or a consumer program that calls either.

## Challenge

challenge: 2026-11-23 — none yet (factual capture, REV-12)
