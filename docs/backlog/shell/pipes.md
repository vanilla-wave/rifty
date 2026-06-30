---
area: shell
status: ready
title: Shell pipes (`a | b`)
created: 2026-06-08
why: `|` tokenized but dispatcher throws — no inter-command stdout→stdin wiring; THE most reflexive terminal action (`cat x | grep y`)
user_story: As a developer at the rifty shell prompt, I want to chain `a | b` so one command's stdout feeds the next's stdin, but today `|` parses then runSegment throws `NotImplementedError('shell.pipe')` — no plumbing between commands.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/shell/src/shell.ts, packages/shell/src/commands/cat.ts, packages/shell/src/commands/grep.ts, packages/shell/src/commands/wc.ts, packages/shell/src/commands/head.ts, packages/shell/src/commands/tail.ts, packages/shell/src/commands/_shared.ts]
---

## Context

`runSegment` throws `NotImplementedError('shell.pipe')` on any `|` (shell.ts:482-487; also startBackgroundJob:398-403). Tokenizer already emits `|` standalone. The stdin contract EXISTS: `CommandContext.stdin?: StdinReader { read(): Promise<Uint8Array|null> }` (types.ts:18-28), wired through `runSegment` → `ctx.stdin` (shell.ts:560), and `git apply` already drains it (git.ts:1927-1930) — the pattern to mirror. BUT the launch-slice filters DON'T read stdin: `cat`/`grep`/`wc`/`head`/`tail` each treat a no-FILE invocation as a usage error ("later phase"/"M12") — so even with the dispatcher wired, `cat f | grep x` can't work until those drain stdin.

## Acceptance

- `runSegment` splits a segment on `|` into N stages, runs them left→right, BUFFERED: each stage runs to completion; its captured stdout becomes the next stage's `ctx.stdin` via a one-shot `StdinReader` (yields the full buffer once, then `null` at EOF). The pipe throw is removed.
- Only the FINAL stage streams stdout to the terminal (`onChunk`); intermediate stages' stdout is captured silent (it's consumed by the pipe). EVERY stage's stderr passes through (bash does not pipe stderr).
- Pipeline exit code = the LAST stage's exit (POSIX; no `pipefail`).
- `cat`/`grep`/`wc`/`head`/`tail` drain `ctx.stdin` when given NO FILE operand (and treat a `-` operand as stdin, GNU). With neither a FILE nor a connected `ctx.stdin`, they keep today's usage-error + non-zero exit. A shared `readAllStdin(ctx)` helper in `_shared.ts` drains the reader to bytes.
- `>`/`>>` redirect still extracts PER STAGE (the existing right-to-left scan runs on each stage's tokens): `a | b > f` writes `b`'s stdout to `f`, and `a > f | b` sends `b` empty stdin (a's stdout went to the file). SIGINT (`ctx.signal`) aborts the whole pipeline.

## Parity cases

- `cat a.txt | grep foo` → only matching lines (stdin-fed grep); exit 0 if any match, 1 if none.
- `ls | wc -l` → entry count (stdin-fed wc); `cat a.txt | wc -l` → line count.
- `cat a.txt | head -n 2` → first 2 lines; `cat a.txt | tail -n 1` → last line.
- `cat a.txt | grep x | wc -l` → 3-stage chain, count of matches.
- `printf '' | wc -l` → `0` (empty stdin, EOF immediately).
- `echo hi | grep nope` → no stdout, exit 1 (last stage); `false | echo ok` → stdout `ok`, exit 0 (last-stage exit).
- `wc -l` with neither FILE nor stdin connected → usage error, non-zero (unchanged).

## Out of scope

- Streamed/backpressure piping — buffered hand-off only (a real tool needing backpressure promotes to the io Readable/Writable contract later); throw nothing, just buffer.
- Faithful stdin INTO a piped `node`/`.bin` program (the reader is wired on `ctx.stdin`, but Node-program stdin parity is a separate item — not a launch-slice target).
- `2>&1` / fd redirection, `|&` (pipe stderr), process substitution — unchanged (no new support; `|&` not tokenized).

## Decisions

- BUFFERED string/bytes hand-off (the draft's "start buffered"): fits the synchronous filters; a one-shot `StdinReader` over the prior stage's stdout bytes mirrors `git apply`'s `ctx.stdin` drain.
- Teaching cat/grep/wc/head/tail to drain stdin is IN-SCOPE here (the epic's "the dispatcher + several builtins' stdin") — without it the chain is dead. `-`-as-stdin follows GNU.
- REVERSIBLE — internal to packages/shell; reuses the public io `StdinReader` contract. CHANGELOG in packages/shell; no ADR.
