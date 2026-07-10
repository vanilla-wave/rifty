---
area: distribution
status: draft
title: EPIC D residual — vue bindings, <RiftyIDE/>, default theme
created: 2026-06-08
why: the ready-solution tail of the bindings ladder after react was carved out — one-tag <RiftyIDE/>, vue atoms, an optional default theme — deferred until a real consumer pulls each
user_story: As a dev on Vue (or one who wants a one-tag IDE), I want `@riftydev/vue` atoms or `<RiftyIDE/>` with a default layout/theme, but today only the react atoms track exists.
sources: [DD-3, DD-4, EPIC D]
---

## Context

2026-07-10: react atoms carved out to `distribution/react-bindings` (epic `embeddable-dev-loop`, ready); this item keeps the residual tail. All of it sits over the SAME `@riftydev/workbench` controllers.

## Options / Next

- `<RiftyIDE/>` default-layout wrapper over the react atoms — lazy one-tag path (S).
- Default theme pack over the DD-4 CSS-vars contract (S).
- `@riftydev/vue` atoms over the same workbench (L) — pull only when a real Vue consumer shows up.
- TS language service integration in the embedded editor (squiggles/hover/defs via the owner-spawn relay) — named residual from `distribution/react-bindings`.

## Reversibility

IRREVERSIBLE per track: each new binding package/public surface gets its own ADR at start (DD-4 theming contract already pre-resolved). Gate: `distribution/react-bindings` shipped + a concrete puller per track.
