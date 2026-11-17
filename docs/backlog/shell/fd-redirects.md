---
area: shell
status: draft
title: Shell fd redirects (`2>`, `2>&1`, `>&2`, `&>`, `<>`, `>|`) beyond fd 0/1
created: 2026-11-17
why: agents append `2>&1` / `2>/dev/null` constantly; rifty throws `NotImplementedError('shell.fd-redirect')` where bash redirects or merges stderr
user_story: As an agent or terminal user, I want `npm test 2>&1 | tail` and `cmd 2>/dev/null` to behave as in bash, but today they fail with a named gap
sources: [packages/shell/fixtures/bash/grammar-table.json, docs/backlog/terminal/reference/review-2026-06-07.md, docs/backlog/shell/simple-command-plan.md, docs/public/compat/shell.md]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts]
---

## Context

Since PR #401 every fd-redirection form in the closed grammar table
(`packages/shell/fixtures/bash/grammar-table.json`) is loud and atomic: an
IO_NUMBER other than fd 0 with `<` / fd 1 with `>`/`>>` (`2>f`,
`2>/dev/null`, `3<f`, `10>f`) and the operators `>&`, `<&`, `&>`, `<>`, `>|`
throw `shell.fd-redirect` before anything runs. Before it, `cmd 2>err.txt`
silently wrote stdout plus a stray `2` argument into the file and `2>&1`
blamed `shell.background`.

Frozen bash 3.2.57 behavior: fixture rows `fd-*`
(`packages/shell/fixtures/bash/command-lists-bash-3.2.57.json`), e.g.
`echo x 2>err.txt` → stdout `x`, empty `err.txt`; `echo x 2>&1` → stdout `x`;
`echo x >&2` → stderr `x`; `echo x &>f` → `f` = `x\n`; `echo x <>f` →
stdout `x`, empty `f`; `echo a >| b` → `b` = `a\n`.

## Question

Implement fd-aware redirects (stderr capture/merge, `>&N`, `&>`, `N<`, `<>`,
`>|`) on the simple-command plan (`shell/simple-command-plan`) — this shell
never redirects stderr today — or keep them loud? Settled at pickup against the
scenarios the shell claims.
