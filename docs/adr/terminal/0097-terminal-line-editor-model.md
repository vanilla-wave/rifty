# ADR 0097: Terminal line-editor model

Status: Accepted
Date: 2026-06-10

> TL;DR: line-mode editor becomes cell/row-aware readline-like input; full PTY remains deferred.

## Context

ADR-0094 made the terminal cursor-aware but still ASCII-ish and single-row. The
UX backlog needs CJK/emoji width, wrapped rows, history search, word motion,
kill/yank, undo/redo, bracketed paste policy, highlighting, multiline input, and
small host rewrites without turning `@riftydev/terminal` into shell/readline.

## Options considered

- Keep ADR-0094 minimal: lowest risk, but leaves visible cursor corruption and
  weak terminal UX.
- Add ad hoc key handlers per feature: easy increments, but duplicated repaint
  math and inconsistent host seams.
- Chosen: one cell/row-aware line-mode editor with host-owned highlighter,
  validator, rewrite rules, suggestions, and tested key classification.
- Defer full PTY/readline/raw-mode: correct long term, too large before process
  stdin/runtime ownership is settled.

## Decision

- Render input by display cells, not UTF-16 units; combining marks, wide code
  points, emoji, and wrapped rows drive cursor math.
- Keep line-mode: `Enter` submits unless host validator returns `incomplete`;
  incomplete input inserts newline into the editable buffer.
- Strip bracketed paste wrappers; pasted newlines stay in the buffer and are not
  auto-executed.
- Add readline-style navigation/history/editing: prefix history, Ctrl/Alt word
  motion, Ctrl+A/E/B/F/P/N, Ctrl+U/K/W/Y, Alt-D/Backspace/Y, Ctrl+R, Ctrl+_,
  delivered Ctrl+Z undo, Ctrl/Cmd+Shift+Z redo.
- Keep Ctrl+C TTY policy: selected text copies; otherwise echo `^C` and emit
  `SIGINT`.
- Host owns shell semantics via `highlighter`, `inputValidator`,
  `ghostSuggestion`, and `rewriteRules`; terminal owns rendering/application.

## Consequences

- `@riftydev/terminal` exports generic input seams; `@riftydev/shell` exports
  shell language-service helpers; playground wires them.
- The editor is much richer but remains line-mode; foreground raw input is owned
  by ADR-0122's shell/runtime stdin bridge rather than by the line editor.
- Repaint code is more complex and must stay unit-tested around wide/wrapped
  input and key classification.

## Acceptance

- [x] Wide/combining/wrapped cursor movement and repaint tests.
- [x] Readline/history/kill-ring/undo/redo key tests.
- [x] Host highlighter/validator/rewrite seams covered via package tests.
