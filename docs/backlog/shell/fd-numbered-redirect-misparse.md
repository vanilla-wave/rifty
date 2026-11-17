---
area: shell
status: draft
title: Shell lexes `N>file` / `N>>file` as an fd redirect, not argument N plus a stdout redirect
created: 2026-11-17
why: `cmd 2>/dev/null` becomes `cmd 2 > /dev/null` — stdout silenced, stderr shown, an extra `2` argument — where bash redirects fd 2
sources: [docs/backlog/terminal/reference/review-2026-06-07.md, docs/backlog/playground/dev-server-stderr-on-shell-stdout.md]
code: [packages/shell/src/tokenize.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17, found while
drafting `dev-server-stderr-on-shell-stdout`). `tokenize.ts` ends a word at
`>` (`WORD_END` :62, op scan :126); a leading digit is never an io-number.
Probe (`npx tsx`, rifty src @ c1dbce6e2, Node v24.16.0):
`tokenize('ls missing 2>/dev/null')` → `ls`, `missing`, `2`, `{op:'>'}`,
`/dev/null`. bash: io-number redirect (POSIX §2.10.2 `io_number`), `ls`
gets one argument and fd 2 goes to /dev/null. No loud throw — a silent
misparse (Fidelity). Fault: corrupt-input at the shell lexer.
Dedup: git grep `2>` / fd redirect over docs/backlog, traps.md — only
`terminal/reference/review-2026-06-07.md:17` (`2>&1` note); sibling wave-1
PR #401 covers newline/heredoc, not io-numbers.

## Next

Owner shell; trigger: any agent/user command with `2>` (very common:
`2>/dev/null`, `2>err.log`). RED first: `ls missing 2>/dev/null` prints
nothing to stderr and `ls` sees one argument; until implemented, `N>` must
throw a named `NotImplementedError('shell.fd-redirect')`, never misparse.
