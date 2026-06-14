---
area: service-worker
status: active
title: Preview URL unusable outside playground-opened tabs
created: 2026-06-11
why: Copied /preview/<port>/ URL 503s/COEP-blocks in a manually opened tab — port is scoped to its owner window
user_story: As a developer previewing my app, I want to paste a copied `/preview/<port>/` URL into a fresh tab and see it load, but today the foreign tab's `clientId` resolves to a window that never posted `rifty:preview:ready` so subresources 503 and the COEP-less error frame is `ERR_BLOCKED_BY_RESPONSE`.
sources: [docs/adr/playground/0124-soft-panels-visual-redesign-adopts-the-gravity-ui-handoff.md]
code: [apps/playground/src/components/PreviewPanel.tsx, packages/service-worker/src/owner-resolver.ts]
---

## Context

Soft Panels preview chrome copies the real preview URL (`<origin>/preview/<port>/`). It only works in tabs the playground opens itself (`↗`, about:blank wrapper inherits the opener's client context). A foreign tab fails twice:

1. `FirstWindowOwnerResolver` routes by the fetch's `clientId` (ADR-0031/0040, pinned by `SW_ROUTING_VERSION`); a foreign tab's subresource requests resolve to that tab, which never posted `rifty:preview:ready` → 503. Navigations slip through only via the empty-clientId first-window fallback.
2. The 503/foreign response lacks COEP headers → `ERR_BLOCKED_BY_RESPONSE` when iframed under credentialless COEP (verified 2026-06-11).

Tried and reverted: standalone `/?preview=<port>` page — same failure (no opener context).

## Options or Next

- Port-keyed owner resolution: when the requesting client has no ready binding, fall back to *any* client (window/worker token) that claimed the port — strictly widens working cases; needs `SW_ROUTING_VERSION` bump + handshake-test updates and a decision subagent (revises ADR-0040's recorded fallback rules).
- COEP headers on all SW preview responses (incl. error paths) so foreign-tab failures degrade to an honest 503 page instead of a blocked frame.

## Reversibility

IRREVERSIBLE when picked up (changes the pinned routing contract; supersede-or-extend ADR-0040 via decision subagent). This item just records the gap.
