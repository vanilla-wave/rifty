---
area: playground
status: parked
title: Light theme for playground (currently dark-only)
created: 2026-06-08
why: Chosen direction is a polished dark IDE; a light/dark toggle is a deferred non-goal
user_story: As a playground developer in a bright room, I want a light/dark toggle so the editor, `rifty-dark` Monaco theme and terminal aren't blinding, but today the playground ships dark-only and no `[data-theme="light"]` token layer exists.
sources: [ADR-0073]
---
## Context
Playground ships dark-only. A light/dark toggle needs coordinated theming of three surfaces: CSS tokens, the Monaco `rifty-dark` theme, and the terminal theme API (ADR-0098). Design system is token-based.
## Options / Next
Provisional (ADR-0073 "Alternatives considered"): ship dark-only. Light theme is an additive `:root[data-theme="light"]` layer added later. Terminal theming is now exposed by ADR-0098.
## Reversibility
Reversible — additive token layer, no provisional code to revert. Parked non-goal; gated on appetite + terminal-theme-options-api landing.
