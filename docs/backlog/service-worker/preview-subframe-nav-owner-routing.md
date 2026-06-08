---
area: service-worker
status: active
title: Route preview sub-frame navigations to the controlling-window bridge owner (not resultingClientId)
created: 2026-06-08
why: iframe nav to /preview/<port>/ aborts (net::ERR_ABORTED) under COI though a page fetch of the same route returns 200 — routePreview resolves the owner from the iframe's own resultingClientId, so the handshake never completes
sources: [ADR-0031, ADR-0073, docs/public/hosting-netlify.md, TASKS M7, TASKS M10]
---
## Context
In-page preview `iframe` navigation to `/preview/<port>/` aborts with `net::ERR_ABORTED` under the cross-origin-isolated page, even though a page `fetch()` of the same route returns 200 (m7-preview-sw covers fetch only). Root cause: `routePreview` (ADR-0031) resolves the preview owner from `event.resultingClientId`, which for an iframe *navigation* is the iframe's own about-to-exist client — not the main-thread bridge that owns the registered port — so the handshake never completes and the commit aborts. Pre-existing: the iframe-render path was never CI-covered (m7 uses fetch, m10-hmr skipped by default, suite runs vs `pnpm dev`). User-visible on deployed COI hosts: Dev server / Real Vite presets show `unavailable`; only the four REPL presets render (see docs/public/hosting-netlify.md "Known limitation"). Provisional today: `PreviewPanel` reports readiness honestly (polls route, attempts nav, shows `live` only if the nav committed, else `unavailable` + "↗ new tab").
## Options / Next
Route sub-frame *navigations* to the controlling-window bridge owner instead of `resultingClientId`. This changes public SW routing behaviour and RECONSIDERS ADR-0031 → per the workflow, launch a dedicated decision subagent that produces a superseding ADR (citing 0031). Also add the missing CI smoke of the `vite preview` (production) build — would have caught both this and the related prod-worker gap ADR-0073 fixed.
## Reversibility
IRREVERSIBLE — reconsiders an already-recorded decision (ADR-0031, public SW routing contract). Do NOT settle inline: spin up an explicit decision subagent that reads ADR-0031 + this context + alternatives + risks and emits the superseding ADR. Decision-subagent gate, not a human stop.
