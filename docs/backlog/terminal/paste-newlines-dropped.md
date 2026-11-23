---
area: terminal
status: draft
title: A multi-line paste into the terminal keeps its line breaks
created: 2026-11-17
why: xterm 5.5 rewrites pasted `\n` to `\r` and the line editor drops `\r`, so `echo a` + newline + `echo b` pasted into the COI terminal submits `echo aecho b` (silent wrong command)
sources: [ADR-0096, docs/public/compat/shell.md]
code: [packages/terminal/src/keys.ts, packages/terminal/src/terminal.ts, apps/playground/src/adapters/playground-app.tsx, apps/playground/src/components/BottomPanel.tsx]
---

## Context

Read from source 2026-11-17 (PR #401 review), not yet observed in a browser:

- `@xterm/xterm@5.5.0` `src/browser/Clipboard.ts:13` `prepareTextForTerminal`
  returns `text.replace(/\r?\n/g, '\r')` before the paste reaches `onData`.
- `packages/terminal/src/keys.ts` `stripUnsafeControls` keeps only `\t` and
  `\n` below 0x20, so every `\r` is dropped: `classifyKey('echo a\recho b')`
  → `{ kind: 'printable', text: 'echo aecho b' }` (unit probe).
- `apps/playground` passes no `inputValidator` to `BottomPanel`, so Enter
  always submits; ADR-0096 keeps pasted newlines in the buffer only when they
  arrive as `\n`.

Since PR #401 `@riftydev/shell` runs a submitted buffer with newlines as a
command list (frozen bash 3.2.57 fixture), so the paste path is the remaining
gap for multi-line input in the COI terminal. At pickup: a browser e2e that
pastes two lines and asserts both commands run (or the buffer keeps both
lines), plus whether the playground should wire `validateShellInput`.
