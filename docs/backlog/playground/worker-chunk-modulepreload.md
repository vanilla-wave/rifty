---
area: playground
status: draft
title: Warm the owner-worker chunk during main-bundle parse
created: 2026-07-07
why: the owner worker chunk (real-vite-bootstrap, ~208 KB gz + shared deps) starts fetching only after the main bundle evaluates and spawns it — a serial network hop on every cold pick→boot path
user_story: As a user picking a preset on a cold cache, I want the owner worker fetch to overlap the main-bundle parse, but today the browser learns about the chunk only from `new Worker(url)`.
sources: [prod build chunk audit 2026-07-07 (real-vite-bootstrap 726 kB raw)]
code: [apps/playground/index.html, apps/playground/vite.config.ts, packages/workbench/src/glue/realVite.ts]
---

## Context

Carved out of the delivered lazy-monaco-bundle-split (PR boot-speedup-phase-b;
the refine-step deviation on that item is recorded in
`process-meta/documentation-debt`). The editor-stack split landed; this hint
did not, because its benefit is
unproven — `<link rel="modulepreload">` populates the DOCUMENT module map,
which module workers do NOT share; the win (if any) comes from the HTTP cache
hit on the hashed immutable asset, and Chrome logs an unused-preload warning.
Needs a build-time plugin (hashed chunk name known only at bundle time) + a
measured cold-network before/after (bench or DevTools trace) before it ships —
an unmeasured hint is cargo cult.

## Acceptance

- Prod `index.html` carries a preload hint for the owner-worker chunk whose
  fetch is observed to start before `new Worker(url)` (network trace).
- Measured cold-cache pick→live delta reported; hint removed if ≤ noise.
- No unused-preload console warning on pages that never boot an owner, or the
  warning is explicitly accepted in the item's Decisions.
