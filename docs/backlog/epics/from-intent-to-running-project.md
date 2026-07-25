---
kind: epic
status: draft
title: From intent to a running Node project
created: 2026-07-09
value: A first-time user chooses an outcome or opens their own project and reaches a truthful install/run result without first learning rifty's internal preset taxonomy.
user_story: As a developer evaluating rifty, I want to run Express, a Node CLI, WASI, or my own project from the first screen, but today I must infer the right path from eleven equally weighted technical starters.
---

## Outcome

The canonical launcher turns rifty's existing runtime capabilities into user goals. Starter paths still run the real templates; project-open paths ingest real files, preserve provenance, and hand off to an explicit install/script run plan. No path claims compatibility before evidence exists.

## User scenario

A new user opens the playground and chooses one of four outcomes: Express preview, Node CLI output, WASI file round-trip, or Open project. For their own project they choose a local folder/archive or a smart-HTTP Git URL, review detected `package.json` scripts and known compatibility blockers, explicitly run install, then select a script. The UI ends at a real preview, a real exit code, or the exact owner/terminal failure provenance; retained cross-source presentation belongs to `actionable-ide-diagnostics`.

## Items

- `playground/outcome-oriented-launcher` — goals and expected outcomes inside the one canonical launcher.
- `playground/project-ingress-transaction` — one atomic validate/stage/publish boundary for every project source.
- `playground/open-local-project` — local folder/current rifty archive as a source adapter.
- `playground/open-git-project` — existing smart-HTTP clone capability as a source adapter.
- `playground/imported-project-run-plan` — explicit package install/script selection and preview-or-CLI outcome.

## Draft gates

The fourth launcher outcome is blocked by the ready `playground/wasi-preset` item in `wasi-in-browser-showcase`; it cannot close as a disabled or simulated action. `playground/project-ingress-transaction` owns the ADR for provenance/reset/publication semantics. `playground/imported-project-run-plan` separately owns the ADR for runtime-plan identity. ZIP/tar interop remains `vfs/workspace-archive-scalability`; share-by-link/export-as-Starter remains `distribution/export-project-as-starter-m13`.
