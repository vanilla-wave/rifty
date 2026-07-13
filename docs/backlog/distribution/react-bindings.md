---
area: distribution
status: ready
title: "@riftydev/react — provider + embeddable dev-loop components"
created: 2026-07-10
why: React is the anchor SaaS stack; without ready components every embedder hand-wires xterm/Monaco/preview glue — the threshold the epic exists to remove
user_story: As a SaaS developer on React, I want `<RiftyProvider>` + `<RiftyEditor/>`/`<RiftyTerminal/>`/`<RiftyPreview/>` atoms I can place in my own layout and brand, but today only the internal Solid playground exists.
epic: embeddable-dev-loop
blocked_by: [distribution/workbench-controllers]
sources: [ADR-0224, DD-4]
---

## Context

Thin React binding over ADR-0224's `@riftydev/workbench` project-session handles (carved out of the old EPIC D kit; vue/`<RiftyIDE/>`/default theme stay in the residual `distribution/framework-bindings-kit`). Consumer owns layout and styling; components auto-wire through provider context without exposing Workbench internals.

## Acceptance

- `npm i @riftydev/react` (peer `react` >= 18) exposes `RiftyProvider` with exact `options: WorkbenchOptions` + `project: ProjectDefinition`, plus `RiftyTerminal`, `RiftyPreview`, `RiftyEditor`, `RiftyFileTree`, `CapabilitiesGate`.
- Zero manual glue in consumer code for the epic scenario — provider opens one Workbench/ProjectSession, wires each atom to its public handles, and closes them in owner order.
- Headless + themeable per DD-4: minimal markup, CSS custom properties + className/slot pass-through; no global styles leaking into the host page.
- `RiftyEditor` = Monaco, lazy-loaded on first mount (dynamic import); `RiftyTerminal` = xterm; Monaco/xterm worker serving covered by the `docs/public/` embedding doc.
- `CapabilitiesGate` renders the host-provided fallback on non-COI/unsupported browsers; broken atoms never mount.
- Package in sync:publish SPEC, lockstep 0.x; arch: imports the Workbench root only, never worker entries, playground, lower glue, or `src/internal/*`; no solid-js.
- Component tests render real React (not source-grep), RED-checked; the epic e2e (`distribution/embed-host-vite-example`) exercises every atom.

## Parity cases

None — no Node-API surface. Behavior oracle = the same dev-loop flows the playground e2e pins (install scroll, LIVE pill, HMR update), re-asserted through the reference host e2e.

## Out of scope

- Vue bindings, `<RiftyIDE/>` one-tag layout, default theme pack → residual `distribution/framework-bindings-kit`.
- SSR rendering of atoms — client-only; mounting without DOM throws a loud actionable error (no hydration half-state).
- Multi-sandbox per page (workbench single-instance rule surfaces as a loud React error).
- TS language service in `RiftyEditor` (squiggles/hover/defs) — plain code editing + dirty/save this pass; named residual in `distribution/framework-bindings-kit`.
- `RiftyFileTree` drag&drop + clipboard — v1 is browse/open/create/rename/delete.

## Decisions

- React-only first wave (user call 2026-07-10); solid components stay in-app (playground is the solid consumer via workbench directly).
- DD-4 (headless + themeable, CSS vars, no batteries-styled) is the decision; implementer records the ADR at track start — content pre-resolved here, no open forks.
- Lifecycle is owned by the provider (one Workbench + one active ProjectSession); atoms are views — no per-atom sandbox/config/controller props.
- Monaco stays a lazy dynamic import (playground boot-speedup pattern), not a hard dependency at module top level.
