---
area: shell
status: parked
title: Shell command substitution `$(…)` / `` `…` ``
created: 2026-06-08
why: not parsed — tokenizer emits the literal characters
sources: [docs/compat/m10-tooling.md, m10-tooling status row]
---
## Context
m10-tooling ❌. tokenize.ts deliberately does NOT support `$(…)` / `` `…` `` / `$((…))` / heredocs — they pass through as literal characters. No nested-command evaluation. Listed in tokenizer's "Deliberately NOT supported" header.
## Options / Next
Deferred (no verified call-site need). Next when needed: parse `$(…)` / backtick spans in tokenizer, recursively `run()` the inner line, splice captured stdout (trailing-newline-trimmed, POSIX) back into the token. Needs the dispatcher reachable from the tokenizer (or a two-pass parse) — currently tokenizer is run-agnostic. Word-splitting of the result is a further sub-decision (today no post-expansion splitting).
## Reversibility
REVERSIBLE — internal to packages/shell. Touches tokenizer↔dispatcher coupling (two-pass parse or callback) but stays in-package. Record the parse-strategy choice here when picked up.
