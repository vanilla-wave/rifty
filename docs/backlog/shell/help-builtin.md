---
area: shell
status: ready
title: `help` builtin — list the commands the shell actually has
created: 2026-06-30
why: a curious user's universal "what can I do here" move (`help`) hits `command not found` exit 127, and the nearest builtin (`head`) is edit-distance 2 (> the suggestion threshold) so there isn't even a "Did you mean" — a dead end with zero discoverability.
user_story: As a newcomer at an unfamiliar shell, I want `help` to tell me what commands exist, but today there is no `help` builtin so it 127s with no suggestion.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/shell/src/builtins.ts, packages/shell/src/shell.ts, packages/shell/src/commands/]
---

## Context

`packages/shell/src/commands/` has no `help.ts`; `CORE_COMMAND_NAMES` (`builtins.ts:44`) omits it; the miss path (`shell.ts:564-570`) 127s. The registry is already enumerable — `commandNames()` (`shell.ts:209-211`). So `help` is a thin listing over data that already exists.

## Acceptance

- `help` → exit 0, lists the registered builtins from the LIVE `commandNames()` registry (sorted, comma-joined or columned), plus one line noting `node` / `npm` / `vite` run programs.
- `help <cmd>` → for a known builtin, a one-line synopsis; for an unknown name, `help: no help topic for '<cmd>'` exit 1.
- Registered like any other builtin (the `builtins.ts` barrel + `CORE_COMMAND_NAMES`), so `help` itself appears in its own listing.

## Parity cases

None — `help` is a rifty discoverability affordance, not a behavior to pin against bash. Verification = a unit test asserting the output lists at least the core builtins (`cat`, `ls`, `grep`, …) and exits 0; `help nonesuch` exits 1.

## Out of scope

- Full GNU-style per-command man pages (a command's own `-h/--help` is separate); `man`.
- Pager/scrolling; colored/categorized layout beyond a flat list.

## Decisions

- Lists from the live registry (not a hand-maintained constant) so the output can't drift from the actual command set.
- REVERSIBLE (in-package shell UX) → CHANGELOG in packages/shell; no ADR.
