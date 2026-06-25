---
area: shell
status: active
title: Byte-exact shell command output and redirects
created: 2026-06-25
why: Shell command output is string-shaped today, which can decode/re-encode bytes and lose fidelity for byte-oriented coreutils, redirects, future pipes, and parity fixtures.
user_story: As a developer running byte-oriented commands such as `head -c`, `tail -c`, or redirects in rifty, I want stdout/stderr bytes to survive unchanged, but today the shell writer API forces command output through strings.
sources: [Q-2026-06-25-shell-research, ADR-0093, docs/backlog/terminal/byte-pty-mode-umbrella.md, docs/backlog/shell/pipes.md, docs/backlog/shell/input-redirect.md]
code: [packages/shell/src/types.ts, packages/shell/src/shell.ts, packages/shell/src/commands/head.ts, packages/shell/src/commands/tail.ts, packages/shell/src/commands/cat.ts]
---

## Context

This is the shell-internal byte fidelity layer, not a replacement for the
terminal byte/PTY umbrella. The umbrella covers terminal/child foreground byte
mode; this item covers command stdout/stderr capture, redirects, fixture
assertions, and the future shell pipe path.

The public `Writer` interface currently accepts `string`. Several commands read
bytes from VFS, then decode into text before writing. Redirects capture text and
encode again when writing the target file. That is not faithful for byte-counting
commands and binary-ish files.

## Options or Next

1. Add an internal byte-capable writer interface for command stdout/stderr.
2. Keep public `Shell.run()` text output for current callers by adapting captured
   bytes at the outer boundary.
3. Make redirects write captured bytes directly.
4. Update `head -c`, `tail -c`, `cat`, and related tests so byte cases prove
   there is no decode/re-encode roundtrip.
5. Coordinate with `pipes`, `input-redirect`, and stdin-filter backlog items so
   they share the same byte stream contract.

## Reversibility

REVERSIBLE if introduced behind internal command context adapters. Any public
API change to `Writer`/`CommandContext` needs decision-workflow review because
`packages/shell/src/index.ts` exports these types.
