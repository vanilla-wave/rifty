---
area: playground
status: draft
title: Viewport-aware workbench geometry and splitters
created: 2026-07-09
why: Fixed 232/280/560 pane defaults leave the editor about 178px wide at 1024px, while the narrow breakpoint stacks preview but leaves a vertical splitter controlling an unused width.
user_story: As a developer on a small laptop, I want editor, preview, and terminal to keep useful dimensions and resize on the visible axis, but today the layout squeezes or mis-sizes primary panes.
epic: adaptive-playground-workbench
sources: [M11, ADR-0075, ADR-0124]
code: [apps/playground/src/glue/layout-store.ts, apps/playground/src/adapters/useLayout.ts, apps/playground/src/components/Splitter.tsx, apps/playground/src/styles/theme.css, apps/playground/src/App.tsx]
---

## Context

Define viewport-derived breakpoint geometry and live bounds that protect minimum useful editor/terminal space. In stacked geometry preview uses row height plus a horizontal splitter with correct pointer axis, keyboard arrows, cursor, ARIA orientation/value, and reset behavior. Desktop pane sizes persist independently; entering/leaving temporary narrow geometry must not overwrite them with zero/stacked values.

Browser verification must cover 800×768, 1024×768, and desktop: no overlapping chrome, inaccessible pane, offscreen restore control, or primary surface below its declared minimum. Monaco/xterm/iframe relayout remains driven by their existing observers.

## Reversibility

REVERSIBLE breakpoint, bounds, splitter-axis, and persistence implementation. Focus-mode selection/defaults are owned exclusively by `playground/workbench-focus-modes-and-sidebar-drawer` and its ADR gate.
