---
area: shell
status: draft
title: Shell heredoc `<<` / `<<-` and here-string `<<<` as command stdin
created: 2026-11-17
why: Agents write files and feed programs through heredocs (20 of 124 shell calls in the 2026-11-12 no-COI office trials); rifty throws `NotImplementedError('shell.heredoc')` where bash runs them
user_story: As an agent in a rifty project, I want `cat > build.js <<'EOF' … EOF && node build.js` to write the file and run it, but today the shell rejects every heredoc
sources: [packages/shell/fixtures/bash/command-lists-bash-3.2.57.json, docs/public/compat/shell.md, ADR-0091, ADR-0093, ADR-0096]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts, packages/shell/src/language-service.ts]
---

## Context

Since 2026-11-17 an unquoted `<<`, `<<-` or `<<<` throws
`NotImplementedError('shell.heredoc')` / `('shell.here-string')` in `tokenize`,
before any segment runs (`docs/public/compat/shell.md` ❌). Before that the
operator lexed as two `<` redirects and the body ran as commands.

Frozen bash 3.2.57 behavior (`packages/shell/fixtures/bash/command-lists-bash-3.2.57.json`,
ids `heredoc-*`, `here-string*`): quoted delimiter → literal body (no `$`,
backtick or `&` processing); unquoted → `$VAR` expansion; `<<-` strips leading
tabs; `<<<` feeds the word plus a newline. Host probe 2026-11-12 (macOS
`/bin/sh`, bash 3.2.57): an unterminated heredoc takes the body to EOF, exit 0.

Evidence of demand: `/Users/vanilla-wave/ai/euphotic/proofs/2026-11-12-no-coi-office-docs`
— 20 heredocs in 124 agent shell calls (7 python, 8 node stdin, 5 `cat > file`).

Seams to settle at pickup: a heredoc token variant changes the exported
`Token` union (ADR-0091 dated line, no supersession); the stdin path reuses
`<` (`bufferStdin`, rightmost stdin redirect wins); the terminal validator
(ADR-0096) must report `incomplete` while a body is pending; command
substitution inside an unquoted body stays loud. `node -` / bare `node` with
piped stdin is a separate gap: `runtime-js/node-stdin-program`.
