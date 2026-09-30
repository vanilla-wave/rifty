# Map — no-coi-visual-debug

## Items

<!-- none seeded: the destination is unratified (goal.md draft) -->

## Open questions

- What "visual debugging" includes beyond an iframe on the resident preview
  URL (console mirror, HMR, DOM/network inspection) — owner: user — asked at FIT.
- Whether the kit's `commands`-only host must become bi-modal (commands ↔
  preview) or the preview runs beside an unchanged command host — owner: agent
  — after the user's scope; ADR-0426 keeps `mode()` caller-owned.

- Fidelity audit rows 6–8 (2026-09-27, kit evidence): no background jobs
  (`shell.background` NIE), 10-min keepalive drain cap, preview mode removes
  file/shell tools — the agent cannot run a dev server itself nor edit while
  one runs; whether this epic changes that — owner: user — asked at FIT.

## Out of scope

- The kit itself — `epics/no-coi-agent-host-kit`.
