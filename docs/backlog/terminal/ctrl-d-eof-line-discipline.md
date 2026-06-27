---
area: terminal
status: draft
title: Ctrl+D always forward-deletes; no EOF-on-empty-line, diverging from readline/Node line discipline
created: 2026-06-13
why: keys.ts:63 maps \x04 (Ctrl+D) unconditionally to {kind:'delete'} routed straight to handleDelete() with no empty-line branch, so the editor can never emit EOF — an interactive REPL/shell reading via the line editor cannot be closed with Ctrl+D, unlike readline/Node where Ctrl+D on an empty line signals EOF.
user_story: As a user at a `node` REPL in the rifty terminal, I want `Ctrl+D` on an empty line to send EOF and exit the prompt like real Node; today `\x04` always forward-deletes so the REPL/shell can never be closed.
sources: [ADR-0096, ADR-0122]
code: [packages/terminal/src/keys.ts, packages/terminal/src/terminal.ts, packages/terminal/src/keys.test.ts, docs/backlog/terminal/reference/terminal-ux-research-2026-06-08.md]
---

## Context

keys.ts:63 `if (data === '\x04') return { kind: 'delete' };`; terminal.ts:1047 routes 'delete' to handleDelete() with no empty-buffer/EOF branch. keys.test.ts:135 asserts classifyKey('\x04')==={kind:'delete'} (encodes the current contract). ADR-0096 lists readline keys but never mentions Ctrl+D/EOF, so the EOF half is silently absent and undocumented. The UX research note already diagnoses the correct behavior and flags it as needing a dedicated decision. Only backlog hits are reference/research artifacts; no actionable terminal item.

## Options or Next

Promote via the design-discussion/ADR path the UX research prescribes (alters the keys.test.ts:135 contract, Node-parity-observable). Decision points: (a) Ctrl+D on empty buffer -> emit a new {kind:'eof'} event that closes stdin / exits the prompt; non-empty buffer keeps forward-delete; (b) define 'close stdin' given ADR-0096 defers foreground raw input to ADR-0122's stdin bridge — wire EOF through that seam; (c) handle browser-default capture for \x04 via attachCustomKeyEventHandler. Add a failing parity/unit test for empty-line EOF before implementing.

## Reversibility

IRREVERSIBLE — needs ADR; changes Node-parity observable behavior and overturns the keys.test.ts:135 contract, intersecting ADR-0096 and ADR-0122. The UX research explicitly routes it to an ADR.
