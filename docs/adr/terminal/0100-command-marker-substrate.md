# ADR 0100: Command marker substrate

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: terminal commands become tracked blocks; optional exit codes drive markers, ruler marks, nav, and selection

## Context

UX backlog calls for exit-status gutter marks, scrollbar history marks, jump-to-prompt, select-whole-command-output, sticky headers, command blocks, and quick fixes. rifty owns the line editor and shell result, so it does not need OSC 133 parsing. `RiftyTerminalOptions.onInput` currently discards command exit status.

## Decision

Widen `onInput` to `number | void | Promise<number | void>`. `RiftyTerminal` records one block per submitted command:

- marker at command start, marker at command end;
- optional exit-code decoration + overview ruler mark when an exit code is returned;
- public block inspection + `scrollToBlock`, `selectBlockOutput`, `jumpBlockPrev/Next`.

No dependency. Decorations are best-effort: if xterm returns `undefined`, block metadata remains.

## Consequences

- Shell mode can render exit status from its existing `runLine()` result.
- REPL/runtime mode can keep returning `void`; no marker color is shown.
- Later sticky headers, command blocks, and quick fixes reuse this single metadata home.

## Acceptance

- [x] Unit tests cover `onInput` exit code capture, decorations, block nav, and selection.
- [x] Playground returns shell exit code to terminal.
- [x] `packages/terminal` and `apps/playground` typechecks pass.
