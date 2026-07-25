---
kind: epic
status: draft
title: Adaptive playground workbench
created: 2026-07-09
value: On a small laptop or wide desktop, the user can always reach Files/Git, Editor, Preview, and Terminal without a primary surface collapsing to unusable dimensions.
user_story: As a developer using rifty at 800, 1024, or desktop width, I want to focus and switch the surface needed for my task, but today fixed pane defaults squeeze the editor at 1024 and the narrow breakpoint hides Files/Git with no visible restore control.
---

## Outcome

Viewport-aware geometry protects minimum useful editor/terminal space, reorients splitters with the layout, and keeps every primary surface discoverable. Temporary narrow modes do not corrupt the user's desktop pane sizes, and the UI never steals a manually selected focus mode.

## User scenario

At 1024×768 a user edits an Express file while opening preview and terminal without the editor collapsing to a sliver. At 800×768 they open Files/Git from a visible drawer control, switch among Editor/Preview/Terminal focus modes by pointer or keyboard, resize the stacked preview on the correct axis, then return to desktop and recover their previous desktop layout.

## Items

- `playground/responsive-workbench-geometry` — viewport-aware bounds, stacking, splitter semantics, and browser coverage.
- `playground/workbench-focus-modes-and-sidebar-drawer` — reachable surfaces, focus modes, keyboard parity, and sidebar drawer.

## Draft gates

Focus modes and drawer ownership extend the observable Soft Panels structure in ADR-0124; the chosen behavior needs a follow-up ADR before `ready`.
