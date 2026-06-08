---
area: shell
status: parked
title: Shell glob expansion (`*`, `?`, `[abc]`)
created: 2026-06-08
why: not parsed — wildcards pass through literally, no pathname expansion
sources: []
---
## Context
m10-tooling ❌. tokenize.ts deliberately does NOT expand `*` / `?` / `[abc]` — listed in the tokenizer's "Deliberately NOT supported" header. Wildcards reach the command as literal argument characters; no VFS directory matching.
## Options / Next
Deferred (no verified call-site need). Next when needed: post-tokenize pass that, for any unquoted token containing glob metachars, lists the cwd dir via FsSync and matches (POSIX: no match → literal token unchanged, `nullglob` off). Quote-awareness already tracked by tokenizer (only unquoted segments glob). A real matcher is small enough to hand-write (`*`/`?`/`[…]`) — avoid pulling minimatch (new dep). NB: opencode include-filter widening (opencode/glob-filter-widening) is a separate, related glob need.
## Reversibility
REVERSIBLE if hand-written matcher stays zero-dep. Pulling a glob lib (minimatch) → IRREVERSIBLE (new dep, needs ADR). Default to in-package matcher; record here.
