---
area: shell
status: draft
title: Shell `$?` expands to the last exit status instead of printing literally
created: 2026-10-16
why: `echo EXIT=$?` prints `EXIT=$?` in the rifty terminal — a silent wrong output where POSIX sh prints the previous command's exit status; scripts and users checking `$?` get no signal
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/shell/parameter-expansion.md]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts]
---

## Context

Mid-task discovery (2026-10-16, esbuild upstream-twin spike, COI terminal,
HEAD `9645c62bf`): `ls node_modules/esbuild-wasm; echo EXIT=$?` → last line
`EXIT=$?`. Host oracle: `sh -c 'false; echo EXIT=$?'` → `EXIT=1` (Darwin
25.6.0 `/bin/sh`). The shell tracks `lastExitCode` for `&&`/`||`
(`shell.ts:427-461`) but the tokenizer has no `$?` expansion.

Related, not duplicate: `shell/parameter-expansion` (`${VAR:-…}` forms that
throw loudly); `$?` is a special parameter that passes through silently.

## Question

Expand `$?` (and which other special parameters a claimed script uses — `$$`,
`$!`, `$#`, `$0`) or refuse unsupported special parameters loudly? Settled at
PICKUP against the scenarios the shell claims.
