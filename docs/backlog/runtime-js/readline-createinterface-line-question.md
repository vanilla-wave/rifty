---
area: runtime-js
status: active
title: node:readline createInterface line/question subset for guest CLIs
created: 2026-06-19
why: readline.createInterface is only tracked inside the aggregate loud-stub backlog, but a small line/question subset would unblock interactive Node CLIs without claiming full TTY/raw-mode parity
user_story: As a developer running a Node CLI that prompts with `readline.createInterface()` or `rl.question()`, I want line-based prompts to work through rifty stdin/stdout, but today `readline.createInterface()` throws before the program can ask for input.
sources: [docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md, docs/backlog/terminal/raw-stdin-deferred-items.md, docs/backlog/terminal/ctrl-d-eof-line-discipline.md, "subagent audit 2026-06-19"]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts, packages/runtime-js/src/builtins/process.ts, tests/conformance/builtins/readline.test.ts]
---

## Context

The runtime currently registers `node:readline` as a loud stub; conformance tests
pin that every method throws. Terminal/editor backlog items cover line-editor
UX, raw stdin, Ctrl+D EOF, and process-group ownership, but they do not track
the guest Node builtin API that packages call directly.

The useful first slice is line-oriented CLI prompts, not full readline/TTY
emulation. It should work with the runtime's existing stdin/stdout streams:
`createInterface({ input, output })`, `'line'` and `'close'` events,
`rl.question(prompt, cb)`, `rl.close()`, and possibly an async iterator. Cursor
painting helpers, raw-mode keypress events, history editing, completion,
`readline/promises`, and TTY redraw fidelity can stay loud until they have
specific consumers and tests.

## Options or Next

- Replace the current `createInterface` throw with a tested minimal Interface
  object while keeping `cursorTo`, `clearLine`, `clearScreenDown`, and
  `emitKeypressEvents` loud unless implemented faithfully.
- Add Node-vs-rifty parity cases for `line`, `question`, `close`, EOF handling,
  CRLF/LF splitting, prompt writes, and late input after close.
- Decide whether `readline/promises` is part of the first slice or a follow-up;
  if included, register the builtin explicitly and test `question()`.
- Coordinate with `terminal/raw-stdin-deferred-items` and
  `terminal/ctrl-d-eof-line-discipline`, but do not make this item depend on
  raw-mode/TUI support.
- Update public compat rows for `node:readline` after the first subset lands.

## Reversibility

REVERSIBLE for an additive line/question subset that preserves loud throws for
unsupported methods. Full raw-mode, terminal editing, or `readline/promises`
registration may become a public contract and should be decided with an ADR if
the first slice expands beyond line-based prompts.
