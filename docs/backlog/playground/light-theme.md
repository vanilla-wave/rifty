---
area: playground
status: parked
title: Light theme for playground (currently dark-only)
created: 2026-06-08
why: Chosen direction is a polished dark IDE; a light/dark toggle is a deferred non-goal
sources: [Q-2026-06-03-309, ADR-0073, Q-2026-06-03-310]
---
## Context
Playground ships dark-only. A light/dark toggle needs coordinated theming of three surfaces: CSS tokens, the Monaco `rifty-dark` theme, and the hard-coded `RiftyTerminal` xterm theme (see Q-310 / terminal-theme-options-api). Design system is token-based.
## Options / Next
Provisional (ADR-0073 "Alternatives considered"): ship dark-only. Light theme is an additive `:root[data-theme="light"]` layer added later. Depends on the terminal theming being exposed (Q-310) for a fully-matched light surface.
## Reversibility
Reversible — additive token layer, no provisional code to revert. Parked non-goal; gated on appetite + terminal-theme-options-api landing.
