---
area: playground
status: draft
title: Outcome-oriented first-run launcher
created: 2026-07-09
why: The canonical launcher exposes eleven equally weighted technical starters, so a first-time user must understand preset taxonomy before choosing the Express, CLI, WASI, or own-project outcome they came for.
user_story: As a first-time rifty user, I want to choose the result I need and know what will happen before boot, but today starter cards communicate implementation category and setup kind rather than a recommended user outcome.
epic: from-intent-to-running-project
blocked_by: [playground/wasi-preset, playground/open-local-project, playground/open-git-project, playground/imported-project-run-plan]
sources: [M11, M13, ADR-0165, ADR-0079, docs/backlog/playground/launch-deeplink-real-npm.md, docs/backlog/playground/wasi-preset.md]
code: [apps/playground/src/components/Launcher.tsx, apps/playground/src/components/StartersTab.tsx, apps/playground/src/presets.ts]
---

## Context

ADR-0165/0079 require one canonical launcher; this item reorganizes that surface rather than adding a second Home or template switcher. The first level should express Express preview, Node CLI output, WASI file round-trip, and Open project, including expected output, real setup (`instant` versus visible `npm install`), and known ceiling links. The full starter gallery remains available below that decision.

The WASI action must not render as a dead promise before `playground/wasi-preset` exists. Open project routes only after the local/Git adapters and imported-project run plan exist; no disabled primary CTA may imply an available flow.

## Options or Next

Refine the information hierarchy and returning-user behavior against the existing remembered `Starters|Projects` tab. Do not change the marketing deep-link contract owned by `playground/launch-deeplink-real-npm`.

## Reversibility

REVERSIBLE launcher IA; any change to project identity/import semantics belongs to the other epic items and their ADR gate.
