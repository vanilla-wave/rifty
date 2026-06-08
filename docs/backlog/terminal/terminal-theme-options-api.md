---
area: terminal
status: parked
title: Theme/font RiftyTerminal via RiftyTerminalOptions (hard-coded today)
created: 2026-06-08
why: xterm theme + fontFamily hard-coded in constructor; matching design tokens needs a public-API change to RiftyTerminalOptions (IRREVERSIBLE, own ADR)
sources: [Q-2026-06-03-310, ADR-0073]
---
## Context
`RiftyTerminal` hard-codes its xterm `theme` (`#0f1115`/`#e6e6e6`) and `fontFamily` (system mono) in its constructor (`packages/terminal/src/terminal.ts:50,52`); `RiftyTerminalOptions` exposes only `onInput`/`onSignal`. Matching the playground design tokens exactly (IBM Plex Mono + token palette) is blocked on a public-API change. Also a dependency of Q-2026-06-03-309 (playground light theme — one of three surfaces to coordinate).
## Options / Next
Add `theme` / `fontFamily` to `RiftyTerminalOptions`; thread into the xterm ctor. Provisional (ADR-0073): leave terminal as-is, anchor playground palette on its existing ink so surfaces read as one. Next: own ADR recording options + trade-offs before building. M10 polish, no verified need yet.
## Reversibility
IRREVERSIBLE — public API change between packages (checklist rule 1). Needs its own ratified ADR. Not a reconsideration of a recorded decision → no decision subagent; just write the ADR inline when taken up. Gated on the polish/theming work actually being needed.
