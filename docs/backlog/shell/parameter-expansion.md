---
area: shell
status: parked
title: Shell parameter expansion (`${VAR:-default}`, `${#VAR}`, `${VAR%suf}` …)
created: 2026-06-08
why: only plain `${NAME}` supported; advanced POSIX forms throw from tokenizer
sources: []
---
## Context
m10-tooling ❌. Tokenizer supports `$VAR` / `${NAME}` only; any `${…}` that isn't a bare name throws `shell.tokenize: unsupported variable expansion form: ${…} — only ${NAME} is supported` (tokenize.ts:50). Loud, not silent. Missing: `${VAR:-default}` / `${VAR:=}` / `${VAR:?}` / `${#VAR}` (length) / `${VAR%suf}` `${VAR#pre}` (trim) / `${VAR/…/…}` (substitute).
## Options / Next
Deferred. Next when needed: extend expandVarAt to parse the `${name<op><word>}` grammar and evaluate per POSIX. `word` operands may themselves contain `$VAR` (recursive expand). Prioritise `:-` / `:=` / `#` / `%` (most common in real scripts/package.json scripts); defer pattern-substitution. Each form is a small, testable branch — add a parity case per form vs Node-less bash reference.
## Reversibility
REVERSIBLE — internal to packages/shell tokenizer; no new dep, no cross-package API. Pure additive parsing on a currently-throwing path.
