---
area: distribution
status: parked
title: EPIC D — framework bindings + atomic component kit (D1-D5)
created: 2026-06-08
why: drop-in per-framework atoms (<RiftyIDE/>, react/vue bindings) over the workbench — deferred, depends-on EPIC C
sources: [DD-3, DD-4, EPIC D]
---
## Context
Compound components auto-wired via a context provider — drop-in atoms, consumer owns layout/styling, no manual plumbing. `<RiftyIDE/>` = default layout over the atoms. L3, depends-on EPIC C (the workbench controllers it binds to).

## Options / Next
- D1: `@riftydev/solid` — `RiftyProvider` + atoms (`RiftyEditor`/`Terminal`/`Preview`/`CapabilitiesGate`/`RunButton`); reuse existing playground components (M, accepted).
- D2: `RiftyFileTree` — the one genuinely new atom (VFS-watch + tree); playground is ~single-file (M, idea).
- D3: `<RiftyIDE/>` default-layout wrapper over atoms — lazy one-tag path (S, idea).
- D4: headless theming — CSS-vars/slots + default theme (DD-4: headless + themeable, Radix/Headless-UI style, not batteries-styled) (M, idea).
- D5: `@riftydev/react` (and/or `@riftydev/vue`) atoms over the SAME workbench — non-Solid consumers (the reason for EPIC C) (L, idea).
- Pull after C lands; D5 is the payoff that justifies the workbench split.

## Reversibility
IRREVERSIBLE: new framework-binding packages + public component/atom API + theming contract → each gets its own ADR. Gate: EPIC C (workbench) must exist first → blocked on workbench-controllers. DD-4 (headless+themeable) promotes to ADR when D4 starts.
