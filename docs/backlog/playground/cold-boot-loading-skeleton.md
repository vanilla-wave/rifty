---
area: playground
status: ready
title: Cold-boot loading skeleton — no blank dark screen on first paint
created: 2026-06-30
why: index.html ships only a dark background + empty `#app`, and main.tsx awaits cross-origin-isolation + bootstrap BEFORE rendering — so on a slow first load (announcement traffic, varied hardware) the visitor faces a dead-looking blank tab with zero progress and may bounce before seeing anything.
user_story: As a first-timer on a slow connection, I want to see that something is loading, but today there is no spinner/skeleton — just a blank dark screen until the bundle boots.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [apps/playground/index.html, apps/playground/src/main.tsx]
---

## Context

`apps/playground/index.html` sets a dark `#131419` background + empty `#app` in its critical `<style>` (no loader markup). `main.tsx` awaits `assertCrossOriginIsolated()` then `bootstrapPlayground()` and only THEN `render(<App>)` — during boot the user faces a blank dark screen with no progress.

## Acceptance

- `#app` in index.html contains a minimal static skeleton/spinner + a "Booting rifty…" line, as pure inline HTML/CSS in the existing `<style>` block (no JS or font dependency — it paints on first byte).
- `render(<App>)` replaces the skeleton on app-ready.
- If boot throws (e.g. the COI assert fails), the existing error path still surfaces — the skeleton must not mask a hard failure.

## Parity cases

None — boot UX. Verification = an e2e asserting that between navigation and app-ready, `#app` is non-empty (skeleton visible), never a blank screen.

## Out of scope

- A progress bar tied to real boot phases; a branded splash animation.

## Decisions

- Inline-in-index.html (not a solid/React component) so it shows before any bundle parses.
- REVERSIBLE (playground UX, no public API) → CHANGELOG in apps/playground; no ADR.
