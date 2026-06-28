---
area: distribution
status: ready
title: rifty.dev/compare — the verifiable WebContainers-alternative page
created: 2026-06-28
why: no verifiable WebContainers/Nodebox/CheerpX/rifty comparison exists anywhere and rifty is on no alternatives list, yet that is exactly what the license-wall audience searches for
user_story: As a developer searching "open source webcontainers alternative", I want one rigorous comparison where every rifty claim links to a tested compat matrix or parity fixture, but today no such page exists and apps/landing is a single static page.
epic: webcontainers-alternative-search-slot
blocked_by: [toolchain-build/compat-matrix-test-result-sink]
sources: [docs/public/open-runtime-position.md, docs/public/trust-model.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [apps/landing/vite.config.ts, apps/landing/src/main.ts]
---

## Context

`apps/landing` is a single static Vite SPA — `src/main.ts` mounts fixed sections into `#app`, `vite.config.ts` has no MPA input / no router (solid-js is NOT used — D-002 holds). `open-runtime-position.md` has the licensing/posture table and the research note has the verified licensing-wedge table, but neither is the 4-column capability+ceilings grid with per-cell anchors the slot needs. `docs/public/open-runtime-position.md` (:49-50) links project-level claims (Express/Vite/npm install) to `docs/ROADMAP.md` until generated project matrices exist.

## Acceptance

- A `rifty.dev/compare` route (an MPA input entry `compare.html` + a section module) renders ONE canonical 4-column (WebContainers / Nodebox / CheerpX / rifty) capability+ceilings table.
- Every rifty cell anchors to a `docs/public/compat/*` matrix or a named parity/e2e fixture.
- A shared-ceilings row (raw TCP / TLS / http2-server / native addons / COOP-COEP) is link-backed to compat ❌ + `trust-model.md`, not prose.
- Each competitor column carries a dated "verified as of" stamp sourced to the research note.
- A build-time link-integrity test (extending the landing-static integration test) FAILS the build if any compare-page cell anchor 404s.

## Parity cases

None — marketing surface, no Node-API behavior. Verification is the build-time link-integrity test.

## Out of scope

- No project-level generated matrices for Express/Vite/npm (those stay ROADMAP-linked until a separate matrices item).
- No third-party-claim auto-refresh (the dated stamp + a manual re-verify note suffice).
- No new compat DATA (that is `toolchain-build/compat-matrix-test-result-sink`).

## Decisions

- MPA input entry over a router — landing has no router; one extra build input is the minimal change and keeps D-002 (no solid-js).
- The canonical table is a new single source the route renders from.
- The page's un-discreditability depends on the result-sink item (hence `blocked_by`); until it lands, any cell over a skipped test must be footnoted, not green.
- REVERSIBLE → CHANGELOG line in apps/landing; no ADR.
