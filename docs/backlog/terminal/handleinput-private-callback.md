---
area: terminal
status: draft
title: Make RiftyTerminal.handleInput private + add onHandleInput callback
created: 2026-06-08
why: handleInput still public async (terminal.ts:104, TSDoc "production callers must not call this"); no test-observability callback; ~30 tests call it directly
user_story: As a user typing into the rifty terminal, I want every keystroke to flow through one real input path so the editor can't desync; today `handleInput` is `public async` — a stray external call can inject a keypress out of band, and there's no `onHandleInput` hook to watch it.
sources: [A-041, REVIEW_ACTIONS.md]
---
## Context
`packages/terminal/src/terminal.ts:104` — `handleInput` is `public async` with a TSDoc note that production callers must not call it. Only test code uses the public surface. A-041 was a review-ledger item not migrated to any ADR — now captured here (this backlog file is its home).
## Options / Next
Make `handleInput` `private`; add `onHandleInput?: (e: KeyEvent) => void` to `RiftyTerminalOptions` for test observability. Blocker: `terminal.test.ts` ~30 tests do `await term.handleInput(...)` and sync on the returned Promise → full test-orchestration rewrite (await on callback emit, not method return). Out of scope for "don't break the suite" tasks → its own focused session. NOTE: never edit tests to make code pass (hard rule) — the rewrite must re-express the same contracts, not relax them.
## Reversibility
REVERSIBLE. Local to `packages/terminal` (no cross-package public API, no new dep, no ADR contradiction; ~1 file + its test). Deferred, not gated. No decision subagent needed.
