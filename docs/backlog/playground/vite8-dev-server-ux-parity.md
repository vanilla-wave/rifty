---
area: playground
status: active
title: vite8 — dev-server UX parity (ready banner, @vite/client ws-warning, preview origin/headers signposting)
created: 2026-06-21
why: The Vite 8 dev server diverges from a fresh `npm create vite` in user-visible UX, partly cosmetic, partly architecturally-required-but-unsignposted: no `VITE vX ready in Nms` + Local/Network URL banner (rifty calls createServer/listen programmatically, not the CLI); `@vite/client` logs a red "[vite] failed to connect to websocket" (HMR off → no ws endpoint); the preview is served at SW-routed `/preview/<port>/` on the playground origin (not http://localhost:5173/) with forced `COEP: credentialless` + `CORP: cross-origin` that a normal localhost dev server never sets.
user_story: As a dev comparing to `npm create vite`, I want either real Vite's ready banner/URLs + clean console, or a clear sandbox signpost (preview lives at /preview/<port>/, HMR off, isolation headers on), but today I get a missing banner, a scary ws error, and a different origin with isolation headers and no explanation.
sources: [apps/playground/src/workers/dev-server-boot.ts, apps/playground/public/sw.js, apps/playground/src/templates/vite.ts, docs/adr/playground/0161-vite-8-disables-hmr-pending-socket-parity.md]
code: [apps/playground/src/workers/dev-server-boot.ts]
---

## Context

`createServer().listen()` is called programmatically, so Vite's CLI `printServerUrls`
banner never prints. `@vite/client` is injected (Vite 8 always injects
`import.meta.hot`) and fails its ws connect because HMR is off — faithful to
real-Vite-with-hmr:false, but noise vs a normal HMR-on project. The SW
(`routePreview`) forces COEP/CORP for cross-origin isolation (needed for the SAB
WASI pthread pool); third-party subresources without CORP would be blocked inside
the preview but load fine on localhost:5173. None of this is signposted.

## Options or Next

Print a sandbox-equivalent "ready" line with the REAL preview URL the user should
open; suppress or annotate the `@vite/client` ws-warning while HMR is off (or fold
into the HMR re-enable work, see `real-vite-browser-e2e`); add a one-time
signpost (terminal or preview chrome) that the preview origin is `/preview/<port>/`
with isolation headers on. Decide which divergences to emulate vs document.
Acceptance: a dev is not misled by the missing banner / ws error / origin shift.

## Reversibility

REVERSIBLE — logging/UX + optional console annotation; no public-API/ADR change.
The COEP/CORP + origin shift themselves are architecturally required (COI for SAB).
