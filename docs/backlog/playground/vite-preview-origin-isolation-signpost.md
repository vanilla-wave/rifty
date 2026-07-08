---
area: playground
status: ready
title: Signpost Vite preview origin and isolation-header divergence
created: 2026-07-08
why: Vite dev preview in rifty is served at same-origin `/preview/<port>/` with COEP/CORP headers, not direct `http://localhost:<port>/`; Vite 8 notes mention this but the default Vite path lacks a general contract.
user_story: As a developer comparing rifty's Vite preview with local Vite, I want the UI/docs to tell me when the preview URL, origin, and isolation headers differ from direct localhost, but today those browser-platform differences are easy to mistake for Vite behavior.
blocked_by: []
sources: [ADR-0097, ADR-0147, ADR-0189, docs/backlog/playground/vite-preview-cors-middleware-parity.md, docs/backlog/playground/vite8-dev-server-ux-parity.md]
code: [apps/playground/src/components/PreviewPanel.tsx, packages/service-worker/src/route-preview.ts, docs/public/compat/vite-command.md]
---

## Context

Rifty's preview route is intentionally browser-shaped:

- the iframe URL is same-origin `/preview/<port>/...`;
- the Service Worker forwards requests to the owner/server realm;
- success and error responses carry COEP/CORP defaults so the playground remains
  cross-origin isolated.

This is not the same browser-visible surface as direct local Vite at
`http://localhost:<port>/`. The transport is honest where it is observable
(HTTP bytes, assets, HMR WebSocket over the generic bridge), but origin and
isolation headers are browser-platform differences. Vite 8's UX item mentions
the problem; default Vite 7 dev preview needs the same general signpost.

## User scenario

A developer opens a rifty Vite preview in-frame or in a new tab, inspects
`location.origin`, response headers, or third-party subresource behavior, and
compares it with local Vite. They should see a clear signal that `/preview/<port>/`
is the rifty browser bridge, while Vite's app code and HMR still run through the
real dev server.

## Acceptance

- Preview UI or docs state that the copy/open preview URL is the rifty
  same-origin `/preview/<port>/` route, not direct `localhost:<port>`.
- The signpost names COEP/CORP isolation headers as host/platform requirements,
  not Vite config authored by the user's app.
- A test pins whichever surface is chosen: UI text/tooltip, compat docs, or both.
- The wording does not imply Vite headers/CORS are fully parity-equivalent;
  `vite preview` header parity stays with
  `playground/vite-preview-cors-middleware-parity`.

## Parity cases

- Real local Vite exposes a direct `http://localhost:<port>/` browser origin.
- Rifty exposes `/preview/<port>/` on the playground origin and routes to the
  same dev-server bytes where the bridge can model them.
- COEP/CORP headers are present on rifty preview responses because the host needs
  cross-origin isolation; direct Vite does not add them by default.

## Out of scope

- Making the browser URL literally `http://localhost:<port>/`; the Service
  Worker cannot own arbitrary loopback origins.
- `vite preview` CORS/header parity; tracked separately.
- Non-Chromium browser parity.

## Decisions

- Treat origin/isolation differences as a platform signpost, not a Vite wrapper
  workaround.
- Do not hide the difference behind marketing copy or a fake localhost URL.
