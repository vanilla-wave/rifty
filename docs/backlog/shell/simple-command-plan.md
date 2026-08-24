---
area: shell
status: draft
title: SimpleCommandPlan lowering before execution
created: 2026-06-25
why: `Shell.runSegment` mixes syntax handling, env-prefix, redirects, glob expansion, command lookup, context construction, abort handling, bin dispatch, and redirect flushing in one broad path.
user_story: As a rifty contributor adding shell behaviour, I want a simple command to be lowered into a testable execution plan before it runs, so adding redirects, env rules, or command resolution does not require editing one wide dispatcher.
sources: [Q-2026-06-25-shell-research, docs/backlog/shell/redirect-target-glob-and-quote-handling.md]
code: [packages/shell/src/shell.ts, packages/shell/src/tokenize.ts, packages/shell/src/command-resolver.ts]
---

## Context

This item does not implement pipes or input redirects by itself. It creates a
deeper locality seam so those backlog items can fit without widening
`runSegment` further.

A simple command plan should represent env-prefix assignments, command argv,
redirect intents, stdin/stdout/stderr modes, TTY implications, command
resolution, and loud unsupported cases before execution starts.

## Options or Next

1. Add a `SimpleCommandPlan` lowering function for one command segment.
2. Unit-test lowering separately from execution: env-only assignment,
   `KEY=value cmd`, quoted empty args, unquoted empty var elision, redirects in
   different argv positions, TTY false under redirect, unsupported `<`/`|`.
3. Keep runtime behaviour stable: parser throws stay throws, command failures
   stay exit-code results, SIGINT remains 130, and `onChunk` ordering is covered.
4. Let `pipes`, `input-redirect`, and fd-aware redirects extend the plan instead
   of adding more ad hoc extraction inside `runSegment`.

## Reversibility

REVERSIBLE internal refactor if current public shell results remain unchanged.
Behavioural changes discovered during lowering need separate backlog/ADR entries.
