---
area: runtime-js
status: draft
title: "A builtin function's `name` reads as Node's"
created: 2026-11-23
why: "`path.dirname.name` is `dirname2`, `setTimeout.name` `setTimeout2`, `fs.ReadStream.name` `FileReadStream` in the isolate guest; Node prints its own names, also as `[Function: dirname]` in inspect"
sources: [docs/backlog/runtime-js/reference/guest-builtin-names-baseline.md]
code: [packages/isolate-guest/scripts, packages/runtime-js/src/builtins]
---

## Context

Names sweep 2026-11-23 (PR #425, isolate guest vs Node v24.16.0;
`runtime-js/reference/guest-builtin-names-baseline.md`): 113 of 404 builtin
module exports and globals differ — 39 bundler suffixes, the rest rifty's
implementation names where Node has its own (Node's are not always the export
name: `wrappedFn`, `bound _format`, `''`). The constructors the fatal report
prints are unit `runtime-js/guest-builtin-names`; this is the rest. Browser
hosts not swept. Fault class `sibling-drift` (source name vs public name).

Owner: runtime-js with isolate-guest (bundle). Trigger: a package or agent
reading a builtin's `name` (feature detection, logging), or the
`guest-builtin-names` unit's by-construction check landing.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
