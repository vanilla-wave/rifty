---
area: runtime-js
status: parked
title: node:readline createInterface line/question subset for guest CLIs
created: 2026-06-19
why: DELIVERED 2026-06-27: readline.createInterface has a line/question subset; raw-mode, keypress, promises, and full TTY editing remain explicit ceilings.
user_story: As a developer running a Node CLI that prompts with `readline.createInterface()` or `rl.question()`, I want line-based prompts to work through rifty stdin/stdout.
sources: [docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md, docs/backlog/terminal/raw-stdin-deferred-items.md, docs/backlog/terminal/ctrl-d-eof-line-discipline.md, "subagent audit 2026-06-19"]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts, packages/runtime-js/src/builtins/process.ts, tests/conformance/builtins/readline.test.ts]
---

## Context

DELIVERED 2026-06-27: `node:readline` now returns an `Interface` for
`createInterface({ input, output })`, emits `'line'` / `'close'`, supports
`rl.question(prompt, cb)`, `rl.close()`, `pause()`, `resume()`, and prompt
get/set/write. Cursor helpers emit ANSI sequences.

This is still not full readline/TTY emulation. Raw-mode keypress events, history
editing, completion, async iteration, `readline/promises`, and TTY redraw
fidelity stay out of scope until they have specific consumers and tests.

## Options or Next

- Keep `emitKeypressEvents`, raw-mode, history editing, completion, async
  iteration, and `readline/promises` as explicit ceilings until real consumers
  justify them.
- Add broader Node-vs-rifty parity cases if the subset expands beyond
  line/question/close.
- Keep terminal stdin forwarding tracked separately; `readline` can consume a
  real input stream, but playground foreground children still expose non-TTY
  stdin until that transport exists.

## Reversibility

REVERSIBLE for the additive line/question subset. Full raw-mode, terminal
editing, or `readline/promises` registration may become a larger public contract
and should be decided with an ADR if the surface expands beyond line prompts.
