---
area: shell
status: parked
title: Shell pipes (`a | b`)
created: 2026-06-08
why: `|` tokenized but dispatcher throws — no inter-command stdout→stdin wiring
user_story: As a developer at the rifty shell prompt, I want to chain `a | b` so one command's stdout feeds the next's stdin, but today `|` parses then runSegment throws `NotImplementedError('shell.pipe')` — no plumbing between commands.
sources: []
---
## Context
m10-tooling ❌ Pending. Tokenizer emits `|` as a standalone token (tokenize.ts) so it doesn't bury inside an arg; runSegment then throws `NotImplementedError('shell.pipe', 'pipe operator not yet supported — M12 work item')` (shell.ts:151). No stdout→stdin plumbing between built-ins/commands yet.
## Options / Next
M12 work item. Next: split a segment on `|`, run each command, feed prior stdout as next stdin (built-ins read a string; spawned cmds need stdin stream). Decide: buffered string hand-off (simple, fits current sync built-ins) vs streamed via @riftydev/io Readable/Writable (matches kernel pipe-stdio backlog). Start buffered; promote to streaming if a real tool needs backpressure.
## Reversibility
REVERSIBLE — internal to packages/shell; no cross-package API. Streamed variant would lean on io stream contract (already public). Record provisional buffered-vs-streamed choice here when picked up.
