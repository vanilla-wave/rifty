---
area: terminal
status: draft
title: Raw stdin residuals — tty.setRawMode/isRaw, literal ETX, richer process groups
created: 2026-06-13
why: ADR-0230 shipped flowing child stdin/EOF, but setRawMode remains loud, isRaw is absent, Ctrl+C is always SIGINT, and richer process-group ownership is still deferred.
user_story: As a user typing into the rifty terminal running an interactive Node TUI (inquirer/blessed), I want `process.stdin.setRawMode(true)` plus literal `Ctrl+C`/`\x03` reaching the program; today `setRawMode()` throws, `isRaw` is absent, and Ctrl+C is always SIGINT, so raw-mode prompts and key-by-key capture cannot work.
sources: [ADR-0122, ADR-0225, ADR-0230, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

ADR-0230 ships ordered flowing child stdin, explicit host EOF, UTF-8 decoding,
and real pause/resume; ADR-0225 ships live TTY resize. Runtime stdin exposes
`setRawMode()` only as a loud `NotImplementedError`, has no `isRaw`, and the
terminal still turns Ctrl+C into SIGINT before raw input. One PTY actor owns the
active run, but raw/cooked state and richer process-group/job ownership do not
exist. Interactive Node TUIs therefore cannot enter raw mode or receive literal
ETX.

## Options or Next

Keep the three ADR-0122 residuals together: (1) `setRawMode`/`isRaw` with one
raw/cooked state owner, (2) literal ETX in raw mode while cooked mode keeps
SIGINT, and (3) process-group/foreground ownership beyond the current single
active-run route. Preserve loud throws until the whole reachable behavior is
defined and parity-tested.

## Reversibility

REVERSIBLE backlog wording. Implementing raw mode/ETX or richer ownership changes
observable behavior and requires the ADR path before merge.
