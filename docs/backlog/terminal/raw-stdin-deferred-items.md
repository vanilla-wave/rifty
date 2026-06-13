---
area: terminal
status: active
title: ADR-0122 deferred items (tty.setRawMode, literal ETX raw mode, terminal process-group ownership) have no backlog home
created: 2026-06-13
why: ADR-0122's Decision explicitly defers tty.setRawMode/literal-ETX-raw-mode/richer process-group ownership to 'future backlog', but none of these exist in docs/backlog and setRawMode/isRaw are absent from packages/ — a real, untracked deferral.
sources: [ADR-0122]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

runtime-js process.stdin types only isTTY/fd/setEncoding/resume/pause — no setRawMode/isRaw anywhere in packages/. Without setRawMode, process.stdin is chunk/cooked-ish only; interactive Node TUIs (inquirer prompts, blessed raw keypress) can't toggle raw mode. Ctrl+C is hardwired as SIGINT so literal ETX bytes can't reach a raw program, and there is no terminal process-group ownership model. docs/backlog/terminal/ has handleinput-private-callback.md (unrelated) + reference/ only; no backlog file references ADR-0122 for these deferrals.

## Options or Next

Create this item capturing the three ADR-0122 deferrals as one tracked unit: (1) tty.setRawMode/isRaw on process.stdin (cbreak/raw line-discipline toggle), (2) literal ETX raw mode so Ctrl+C delivers \x03 to a raw program instead of SIGINT, (3) richer terminal process-group / foreground-owner ownership beyond the current single foreground route. Add // TODO(backlog: terminal/raw-stdin-deferred-items) at the process.stdin shape and the onRawInput/Ctrl+C policy site. Reference ADR-0122.

## Reversibility

REVERSIBLE — backlog item; filing a doc + TODO marker, no public API change. Implementing setRawMode/ETX later alters Node-parity observable behavior and would need its own ADR.
