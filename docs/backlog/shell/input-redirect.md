---
area: shell
status: ready
title: Shell input redirect (`cmd < file`)
created: 2026-06-08
why: `<` tokenized but throws — no stdin-from-file wiring; symmetric to the working `>`, shares the pipes stdin contract
user_story: As a developer at the rifty shell prompt, I want `wc -l < data.txt` to feed a VFS file as stdin, but today `<` tokenizes then throws `NotImplementedError('shell.input-redirect')` — only workaround is bash via WASI.
epic: frictionless-first-poke
blocked_by: [shell/pipes]
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/shell/src/shell.ts, packages/shell/src/commands/_shared.ts]
---

## Context

`runSegment` throws `NotImplementedError('shell.input-redirect')` on any `<` (shell.ts:475-480; also startBackgroundJob:404-409). The symmetric `>`/`>>` extraction already lives in `runSegment` (shell.ts:514-522): a right-to-left scan that pulls each `op`+target pair out of argv, rightmost target winning. `<` mirrors it on the read side, and reuses the same one-shot `StdinReader` + builtin stdin-draining the [[pipes]] item lands. Depends on pipes for the stdin contract (the filters drain `ctx.stdin`).

## Acceptance

- `runSegment` extracts a trailing/anywhere `< file` pair (mirror the `>` right-to-left scan; rightmost `<` wins, the pair leaves argv), reads `file` via `syncMirror()` at the resolved cwd path, and feeds its bytes as the stage's `ctx.stdin` (one-shot `StdinReader`, EOF after). The `<` throw is removed.
- A missing/unreadable redirect file → `bash`-shape error to stderr (`<cmd>: <file>: No such file or directory`) and exit 1; the command does NOT run.
- Composes with pipes: `grep x < a.txt | wc -l` — `a.txt` is stage-1 stdin; the pipe carries stage-1 stdout onward. An explicit `< file` on a stage overrides any inherited pipe stdin for that stage.
- Filters honor it via the same no-FILE stdin-drain the pipes item adds (`wc -l < f`, `grep p < f`, `cat < f`).

## Parity cases

- `wc -l < a.txt` → line count of `a.txt` (no filename column, GNU stdin mode).
- `grep foo < a.txt` → matching lines; `cat < a.txt` → file contents verbatim.
- `wc -l < missing` → `wc: missing: No such file or directory`-shape stderr, exit 1, no count printed.
- `grep x < a.txt | wc -l` → redirect + pipe compose, count of matches.

## Out of scope

- Heredoc `<<` / herestring `<<<` (not tokenized — stay literal/loud elsewhere), fd duplication `<&`, `<>` read-write — no new support.

## Decisions

- Mirror the existing `>`/`>>` extraction scan exactly (anywhere-in-command, rightmost wins) on the read side — keeps redirect handling symmetric and in one place.
- Reuse the [[pipes]] one-shot `StdinReader` + `readAllStdin` filter drain (blocked_by pipes); an explicit `< file` overrides inherited pipe stdin for that stage.
- REVERSIBLE — internal to packages/shell, reuses FsSync read + the io `StdinReader` contract. CHANGELOG in packages/shell; no ADR.
