---
area: shell
status: draft
title: Shell fd redirects (`2>`, `2>&1`, `>&2`, `&>`) and process substitution are misparsed
created: 2026-11-17
why: `cmd 2>err.txt` silently writes stdout plus a stray `2` argument into the file; `2>&1`, `>&2`, `&>` throw a misattributed `shell.background`; `<(cmd)` reports a fabricated ENOENT
user_story: As an agent or terminal user, I want `npm test 2>&1 | tail` and `cmd 2>/dev/null` to behave as in bash or fail with a named gap, but today they misroute output or blame background jobs
sources: [docs/backlog/terminal/reference/review-2026-06-07.md, docs/backlog/shell/simple-command-plan.md, docs/public/compat/shell.md]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts]
---

## Context

The tokenizer has no fd-number or `&`-redirect operators: `2>` lexes as word
`2` + `>`, `>&2` as `>` + background `&` + `2`, `<(` as `<` + word `(cmd`.

| input | GNU bash 3.2.57 (macOS 26.6.2, `/bin/bash --noprofile --norc -c`) | rifty `Shell.run` @ 1f61b7bc5 (MemoryFsSync cwd `/p`) |
|---|---|---|
| `echo x 2>err.txt` | stdout `x\n`, `err.txt` empty, exit 0 | stdout empty, `err.txt` = `x 2\n`, exit 0 (silent) |
| `echo x 2>&1` | stdout `x\n`, exit 0 | throws `shell.background` |
| `echo x &>f.txt` | `f.txt` = `x\n`, exit 0 | throws `shell.background` |
| `echo x >&2` | stderr `x\n`, exit 0 | throws `shell.background` |
| `cat <(echo x)` | stdout `x\n`, exit 0 | `cat: (echo: No such file or directory`, exit 1 |

Since PR #401 `>&`, `<&`, `&>`, `<>`, `>|` throw `NotImplementedError('shell.fd-redirect')` and `<(…)` throws `shell.compound-command` (unquoted parenthesis); `N>file` stays silent. The first row is a silent wrong file effect; the others are loud but
misattributed. Agents commonly append `2>&1` / `2>/dev/null`. The 2026-06-07
terminal review noted `2>&1` (no item was created). The agent prompt states
that `2>` / `2>&1` may be missing or differ. Not caused or newly reached by
the 2026-11-17 newline-list change.

## Question

Implement fd-aware redirects (stderr capture/merge, `>&N`, `&>`, `N<`) on the
simple-command plan (`shell/simple-command-plan`), or reject every fd-number /
`&`-redirect / process-substitution form with a named `NotImplementedError`
first? Settled at pickup against the scenarios the shell claims.
