---
area: playground
status: draft
title: Vite 8 preview URL, HMR-off, and isolation signposting
created: 2026-06-21
why: Installed Vite 8 prints its real CLI banner, but its guest-loopback URL is not the browser-visible `/preview/<port>/` route; HMR is visibly disabled and isolation headers differ from localhost without a user-facing explanation.
user_story: As a developer comparing to `npm create vite`, I want the real banner plus a clear mapping to rifty's preview URL, HMR-off policy, and isolation headers instead of misleading loopback guidance.
sources: [apps/playground/src/workers/vite-cli-prep.ts, apps/playground/public/sw.js, apps/playground/src/templates/vite8.ts, docs/adr/playground/0161-vite-8-disables-hmr-pending-socket-parity.md]
code: [apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/templates/vite8.ts]
---

## Context

Installed `.bin/vite` owns startup and prints Vite's CLI banner. Its Local URL
names guest loopback, while the usable browser URL is the routed preview.
`server.hmr: false` is visible template policy; browser proof must establish
whether `@vite/client` still emits a misleading WS warning. The SW
(`routePreview`) forces COEP/CORP for cross-origin isolation (needed for the SAB
WASI pthread pool); third-party subresources without CORP would be blocked inside
the preview but load fine on localhost:5173. None of this is signposted.

## Options or Next

Browser-prove the console state, then add preview chrome that maps the CLI's
guest URL to `/preview/<port>/` and explains HMR-off/isolation. Do not forge or
rewrite Vite's own banner. Acceptance: no misleading URL, WS error, or origin
assumption remains unexplained.

## Reversibility

REVERSIBLE — logging/UX + optional console annotation; no public-API/ADR change.
The COEP/CORP + origin shift themselves are architecturally required (COI for SAB).
