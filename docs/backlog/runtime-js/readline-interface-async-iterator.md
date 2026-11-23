---
area: runtime-js
status: draft
title: readline Interface is async iterable
created: 2026-11-17
why: `for await (const line of rl)` throws "not async iterable" in rifty; Node yields lines
sources: [docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17). The common
line-by-line idiom `for await (const line of readline.createInterface({ input }))`
fails: probe (scratch parity case, Node v24.16.0 vs rifty) `typeof
rl[Symbol.asyncIterator]` → Node `function`, rifty `undefined`; rifty throws
`TypeError: readline.createInterface(...) is not a function or its return value
is not async iterable`. `node-builtins-loud-stub-capability-gaps` lists readline
surfaces that throw `NotImplementedError`; this member is silently absent, with
no compat row. Dedup: git grep readline / asyncIterator over docs/backlog — no
item.

## Next

Owner runtime-js; trigger: a claimed CSV/line reader using `for await` over
readline (common in agent-written scripts). RED first: parity case iterating a
file's lines with `for await`, incl. early `break` closing the Interface.
