---
area: distribution
status: parked
title: EPIC E — create-rifty starter template (E1-E3)
created: 2026-06-08
why: host config that CANNOT be packaged into a library — COOP/COEP headers, module-worker config, sw.js build, WASM copy, worker URLs — only templated; this is exactly the bundler-bit boundary the SDK facade can't hide
user_story: As a dev standing up a rifty host, I want `npm create rifty-app` to scaffold the un-packageable wiring — Vite COOP/COEP headers, module-worker config, `sw.js` build, WASM asset copy, worker URLs (plus a bundled Monaco/CodeMirror IDE shell), but today no template exists; I must hand-wire every host bit `createSandbox` can't hide.
sources: [EPIC E, ADR-0071 (B2 honest limit)]
---
## Context
The un-packageable host wiring. createSandbox (EPIC B/B2) explicitly cannot hide worker URLs, `sw.js` build, WASM asset serving — those land here as a scaffold. depends-on EPIC B (+ EPIC D for the UI shell). "Hosted IDE from a template" sits at the far end of the ready-IDE spectrum (B+A embeddable → +C+D drop-in `<RiftyIDE/>` → +E hosted).

## Options / Next
- E1: Vite template — COOP/COEP headers, module-worker config, `sw.js` build, WASM asset copy, worker URLs; one-command scaffold of the un-packageable host config (M, idea).
- E2: bundle Monaco (or CodeMirror) integration + workers in the template — editor engine is heavy/host-specific (M, idea).
- E3: `npm create rifty-app` shell + opinionated default IDE shell — "hosted IDE from a template" (L, idea).
- Pull once B (and D for the UI) are solid enough that a consumer wants a one-command host scaffold.

## Reversibility
Reversible as a standalone scaffold repo/template (no `@riftydev/*` public-API change — it CONSUMES the packages). Gate: depends-on EPIC B (shipped) + EPIC D (parked) for the UI shell → effectively blocked on framework-bindings-kit for E2/E3; E1 (host headers/worker config only) could start on B alone.
