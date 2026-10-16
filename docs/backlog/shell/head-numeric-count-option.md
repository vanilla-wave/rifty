---
area: shell
status: draft
title: `head -NUM` (numeric count option) prints the first NUM lines instead of `invalid option`
created: 2026-10-16
why: `ls node_modules | head -40` fails with `head: invalid option -- '40'` in the rifty terminal; macOS/BSD and GNU `head` accept `-NUM` as `-n NUM`, a form common in docs and agent-typed commands
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md]
code: [packages/shell/src/commands/head.ts]
---

## Context

Mid-task discovery (2026-10-16, esbuild upstream-twin spike, COI terminal,
HEAD `9645c62bf`): `ls node_modules | head -40` → `head: invalid option -- '40'`
(`head.ts:128`; only `-n`/`-c` forms parse, `:100-116`). Host oracle:
`printf '1\n2\n3\n' | head -2` → `1` `2` (Darwin 25.6.0 `/usr/bin/head`).

## Question

Accept `-NUM` for `head` (and `tail`, which shares the form) exactly as the
host tools do, including combined forms (`-5c`?) — which variants does the
oracle accept? Settled at PICKUP by host probes.
