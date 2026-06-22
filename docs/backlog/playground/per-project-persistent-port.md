---
area: playground
status: active
title: Per-project persistent preview port
created: 2026-06-21
why: defaultPort is per-template, not per-project (ADR-0078); two projects from the same Starter switched back and forth reuse one listen port, and the switch flips the preview port (interacts with preset-switch-port-flip-window)
user_story: As a user with two open projects on the same Starter, I want each to keep a stable preview port/URL across switches, but today the port comes from the template spec so both share it and the preview URL churns on every switch.
sources: [ADR-0165, ADR-0078, ADR-0148]
code: [apps/playground/src/templates/project-spec.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/App.tsx]
---

## Context

`defaultPort` lives on `ProjectSpec` (per template), passed as `RIFTY_RFV_PORT`/`PORT` at owner spawn. ADR-0165's switch respawns the owner per project, so the listen port is re-derived from the template each time — two same-Starter projects collide on one port and the preview URL changes on every switch. Distinct from `preset-switch-port-flip-window` (which is about the flip WINDOW during a switch); this is about a STABLE per-project port identity.

## Options or Next

- Allocate + persist a per-project port in the project index (ADR-0165 layout), passed as `RIFTY_RFV_PORT` on respawn instead of the template default.
- Define collision/range policy (port pool) and SW preview routing impact (ADR-0097/0123 port-aware routing).
- Decide whether a single active dev server even needs distinct ports per project, or only a stable URL — the exactly-one-active model (ADR-0165) may make a fixed single port acceptable, deferring per-project ports.

## Reversibility

REVERSIBLE — port allocation strategy recorded here; index gains a port field (additive). No public API change. Coordinate with `preset-switch-port-flip-window`.
