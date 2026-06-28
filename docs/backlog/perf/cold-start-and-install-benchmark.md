---
area: perf
status: ready
title: Measured cold-start + npm-install benchmark for the launch
created: 2026-06-28
why: no standing wall-clock benchmark exists, so any launch headline number is an unverified aspiration — quoting one violates the Fidelity rule
user_story: As the maker preparing a launch, I want a reproducible measured cold-start and npm-install-to-first-response number on a fresh Chromium tab, but today nothing measures wall-clock so a forced in-thread walk-back is the risk.
epic: open-auditable-launch
sources: [docs/backlog/perf/reference/speed-benchmarks.md]
---

## Context

`docs/backlog/perf/reference/speed-benchmarks.md` (a reference doc, exempt from the linter) defines PB-1 (harness), PB-2 (boot instrument), PB-5 (npm-install) — none implemented; it states there is "no standing speed benchmark" and PB-5 magnitude is unproven. There is no `pnpm bench`. Boot path: COI guard → VFS (OPFS/memory) → SW register → runtime worker. The prod registry proxy is deployed + CI-smoked (M9), but the pnpm-preview e2e lane has no npm proxy (tests/e2e-prod notes it cannot install offline) and PB-5 is marked "blocked / size conservatively" in the reference — so the install number must come from the harness pointed at the deployed `registry.rifty.dev` via env-config (D-004), not the offline preview lane.

## Acceptance

- A `pnpm bench` script + minimal harness produces, repeatably (median of N runs, fresh profile): (a) cold-start-to-interactive ms for the `?preset=real-vite&autorun=1` deep-link, and (b) npm-install-to-first-Vite-response ms for the real-vite dep set, with the harness pointed at the deployed `registry.rifty.dev` proxy via env-config (D-004).
- The numbers are emitted to a committed JSON artifact a launch GIF/title can cite.
- A CI smoke runs the harness and gates on it PRODUCING the artifact (not on absolute ms): cold-start unconditionally; the npm-install number only when a proxy URL is configured, else recorded as "requires proxy" — never silently skipped. Reconcile with PB-5's conservative-sizing note in the reference.
- The figure quoted at launch is the measured median, conservatively rounded up.

## Parity cases

None — performance measurement, no Node-API behavior to pin. Verification is the harness producing a stable artifact in CI.

## Out of scope

- No perf REGRESSION budget/gate (PB-3+ stays in the speed-benchmarks reference).
- No boot-path micro-optimizations (any low-hanging fix is a separate `perf/*` item).
- No multi-browser numbers — Chromium only.

## Decisions

- Harness = a zero-dep timing runner driving a headless Chromium tab via the existing playwright infra (not vitest `bench`, which can't host a real tab + SW + COI).
- Numbers reported as median-of-N, rounded conservatively (Fidelity: never quote an unmeasured figure).
- REVERSIBLE → CHANGELOG line; no ADR.
