---
area: playground
status: ready
title: Launch deep-link — zero-click land on the real npm-install→preview moment
created: 2026-06-28
why: cold-boot lands on PROJECT_FILES_PRESET (instant module graph, no npm install visible); the launch wants a stable URL that drops a first visitor straight into the headline npm-install→preview run
user_story: As a first-time visitor arriving from a launch link, I want to land directly on the npm-install→preview moment without clicking, but today DEFAULT_PRESET is PROJECT_FILES_PRESET and there is no URL param to select or auto-run a preset.
epic: open-auditable-launch
sources: [docs/research/open-webcontainers-alternative-2026-06.md]
code: [apps/playground/src/presets.ts, apps/playground/src/main.tsx]
---

## Context

`PRESETS` + `DEFAULT_PRESET = PROJECT_FILES_PRESET` live in `apps/playground/src/presets.ts:461-472`; the `real-vite` preset (`:385-397`, label "Real npm project", `from-scratch`) runs a visible `npm install` then boots Vite (`presetBootLines` `:486-497`). No URL query parsing exists today — only a `location.hash.includes('test=execsync')` e2e gate (`main.tsx:44`). The launch tactic "the demo IS the launch" is therefore not current behavior.

## Acceptance

- A `?preset=<id>` query param selects that preset on load; `&autorun=1` auto-starts its boot lines.
- An unknown/invalid `preset` id falls back to `DEFAULT_PRESET` and does not crash.
- With NO params, cold boot stays `PROJECT_FILES_PRESET` (instant first paint for non-launch traffic is unchanged).
- A playwright e2e loads `?preset=real-vite&autorun=1` and asserts the terminal shows `npm install`, then the Vite dev-server preview responds.

## Parity cases

None — playground UX, no Node-API behavior to pin. Verification is the playwright e2e in Acceptance.

## Out of scope

- No new presets (reuses existing `real-vite`).
- No server-side share-link or encoded-state URLs (that is M13 share-by-link — `distribution/export-project-as-starter-m13`).
- No autorun for any preset whose boot mutates state beyond the sandbox (none exist; all boots are in-sandbox).

## Decisions

- Deep-link over flipping the cold-boot default — keeps the instant demo for ordinary traffic; the launch URL opts into the slow real run.
- Param shape is final: `?preset=<id>&autorun=1`. Unknown id → silent fallback to `DEFAULT_PRESET`.
- REVERSIBLE (playground UX) → CHANGELOG line in apps/playground; no ADR.
