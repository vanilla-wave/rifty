---
area: shell
status: active
title: stdin-filter modes unbuilt: no builtin consumes ctx.stdin (wc/cat/head/tail/grep + sort/uniq/cut/tr)
created: 2026-06-13
why: ADR-0089 added ctx.stdin specifically to make stdin-filter coreutils buildable, but only mouse-demo reads it and every filter hard-rejects stdin mode — so once pipes (|) and input-redirect (<) land their RHS/redirect targets have nothing that consumes the stream; this is the missing third leg those two backlog items implicitly depend on but do not cover.
user_story: As a developer at the rifty shell prompt, I want `printf 'a\nb\n' | wc -l`, `cat < f`, or `grep PAT` with no FILE to read piped/redirected input, but today every filter rejects stdin mode (`grep` exit-2, `wc` exit-1) since none consume `ctx.stdin`.
sources: [ADR-0089]
code: [packages/shell/src/commands/grep.ts, packages/shell/src/commands/cat.ts, packages/shell/src/commands/wc.ts, packages/shell/src/commands/head.ts, packages/shell/src/commands/tail.ts, packages/shell/src/types.ts, packages/shell/src/shell.ts]
---

## Context

ctx.stdin is plumbed (shell.ts:67,539) and StdinReader exported, but no filter reads it. grep returns exit-2 'stdin mode not supported' when no FILE; cat exit-1 'missing argument'; wc exit-1 'no file operand'; head/tail exit-1 'reading from standard input is not implemented' on '-'. sort/uniq/cut/tr have no command file at all. backlog/shell/pipes.md and input-redirect.md cover only the dispatcher split-and-feed wiring; neither tracks making the builtins read ctx.stdin. So `cat < f`, `wc < f`, `grep PAT` (no FILE), or any pipe-RHS filter cannot consume input even after pipes/redirect land.

## Options or Next

Add a stdin-read path to each filter, gated on ctx.stdin presence (absent => keep the clean error per ADR-0089's obligation). Drain ctx.stdin.read() to EOF, decode, and route through the same render/count/slice logic as a file; treat the '-' operand and no-FILE case as stdin when ctx.stdin is present. Coordinate the buffered-string-vs-io-Readable hand-off shape with pipes.md/input-redirect.md (one decision). sort/uniq/cut/tr are net-new builtins — may warrant a sub-item. Failing parity test first: `printf 'a\nb\n' | wc -l` and `cat < f` vs real coreutils.

## Reversibility

REVERSIBLE — backlog item; internal to packages/shell, no cross-package API change (ctx.stdin contract already public). Record the buffered-vs-streamed hand-off choice provisionally when picked up.
