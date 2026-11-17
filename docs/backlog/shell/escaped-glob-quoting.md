---
area: shell
status: draft
title: A backslash-escaped glob character stays literal, as in bash
created: 2026-11-17
why: `echo a\*` expands like `a*` — the escape does not set the token's `quoted` flag — where bash prints `a*`
sources: [ADR-0091, docs/public/compat/shell.md]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts]
---

## Context

GNU bash 3.2.57 (macOS 26.6.2, `/bin/bash --noprofile --norc -c`) vs rifty
`Shell.run` @ 7691a6584 (MemoryFsSync cwd `/p`), 2026-11-17:
`touch a1 a2; echo \a*  a\*` → bash `a1 a2 a*`, rifty `a1 a2 a1 a2` (silent).

ADR-0091 defines `quoted` by quote characters; POSIX counts the escape
character as quoting. The whole-word `quoted` flag cannot mark one escaped
character, so a fix touches the ADR-0091 token contract (dated line or a
per-character provenance decision).
