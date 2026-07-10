---
area: playground
status: draft
title: Workbench focus modes and Files/Git drawer
created: 2026-07-09
why: At the narrow breakpoint the sidebar and command bar disappear, leaving no visible Files/Git restore affordance and no way to prioritize Editor, Preview, or Terminal for the current task.
user_story: As a developer working in a narrow rifty window, I want to open Files/Git and focus Editor, Preview, or Terminal with pointer or keyboard, but today key surfaces vanish or compete for the same small viewport.
epic: adaptive-playground-workbench
sources: [M11, ADR-0075, ADR-0124]
code: [apps/playground/src/App.tsx, apps/playground/src/adapters/useLayout.ts, apps/playground/src/components/CommandPalette.tsx, apps/playground/src/styles/theme.css]
---

## Context

Add an always-visible narrow-mode surface switcher plus a Files/Git drawer with focus trap/restore, Escape, pointer and keyboard/palette parity. Focus modes expose Editor, Preview, and Terminal without destroying their live state. Closing a drawer or returning to desktop restores a valid target; hidden panes are not keyboard-focusable.

Scenario-driven suggestions may select an initial mode (server→preview, CLI→terminal) only before user intent. Once the user selects a mode, background lifecycle events must not repeatedly steal focus. Exact responsive chrome ownership and desktop coexistence need the adaptive-workbench ADR before `ready`.

## Reversibility

IRREVERSIBLE observable navigation/default choice → ADR before `ready`; app-internal state and adapters are reversible.
