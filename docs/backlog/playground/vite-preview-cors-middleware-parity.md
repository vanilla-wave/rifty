---
area: playground
status: draft
title: Vite preview CORS middleware parity over the browser preview bridge
created: 2026-06-28
why: Vite 7 `preview` now runs through the real installed CLI, but the browser bridge serves preview traffic same-origin at `/preview/<port>/`; Vite's preview CORS middleware is disabled in the CLI source patch until that cross-origin surface is faithfully modelled.
user_story: As a developer using `vite preview` in rifty, I want preview HTTP headers and CORS behavior to match real Vite where observable, or to see a loud tracked ceiling instead of a silent sandbox-only divergence.
sources: [ADR-0173, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [apps/playground/src/workers/vite-cli-prep.ts, tests/e2e/vite7-build-preview.spec.ts]
---

## Context

`vite preview` is routed through the real installed Vite CLI and serves the
built `dist/` output through the existing Service Worker preview path. In rifty,
the browser-visible URL is same-origin `/preview/<port>/...`, not real Vite's
direct `http://localhost:<port>/...` origin. Vite's preview CORS middleware is
therefore disabled in the CLI source patch for now; otherwise the middleware
observes a synthetic bridge origin/host shape that is not the direct localhost
contract it was written for.

This is a tracked ceiling, not template behavior. Templates must not rely on
the disabled middleware.

## Done When

- Preview requests preserve and expose Vite's real CORS behavior for the
  browser-routed `/preview/<port>/...` surface, or the UI/compat docs clearly
  signpost why this origin cannot be equivalent.
- E2E covers at least one header-sensitive preview request through the real
  `vite preview` CLI.

## Reversibility

REVERSIBLE playground runtime adapter behavior. No public package API changes.
