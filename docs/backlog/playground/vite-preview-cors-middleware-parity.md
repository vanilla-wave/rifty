---
area: playground
status: ready
title: Vite preview CORS middleware parity over the browser preview bridge
created: 2026-06-28
why: Vite 7 `preview` now runs through the real installed CLI, but the browser bridge serves preview traffic same-origin at `/preview/<port>/`; Vite's preview CORS middleware is disabled in the CLI source patch until that cross-origin surface is faithfully modelled.
user_story: As a developer using `vite preview` in rifty, I want preview HTTP headers and CORS behavior to match real Vite where observable, or to see a loud tracked ceiling instead of a silent sandbox-only divergence.
sources: [ADR-0173, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [packages/workbench/src/workers/vite-cli-prep.ts, tests/e2e/vite7-build-preview.spec.ts]
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

## User scenario

A developer builds a Vite app in rifty, runs `vite preview`, and inspects
headers from the preview iframe or a same-origin fetch. The observable CORS and
host behavior should match real Vite preview where the browser bridge can model
it; if not, rifty must fail loudly instead of making template-specific behavior
look portable.

## Acceptance

- `vite preview` without user preview config serves `dist/` through the real
  installed Vite CLI and registers the production preview port.
- A project-root `vite.config.{js,ts,mjs,cjs,mts,cts}` or `vite preview --config`
  throws `NotImplementedError('vite.preview.config-loading')` until preview
  config/CORS semantics are modelled; no silent config ignore.
- CORS/host header behavior through `/preview/<port>/...` is either byte-for-byte
  equivalent to the direct Vite preview server where observable, or documented as
  an explicit compat limitation.

## Parity cases

- Compare direct Node/Vite `preview` headers with rifty preview bridge headers
  for a static asset and an HTML document.
- Cover a user config that changes `preview.cors` / `preview.allowedHosts`; rifty
  must either honor the same observable headers or loud-throw the config ceiling.

## Out of scope

- User preview config loading remains `NotImplementedError('vite.preview.config-loading')`
  until this item lands.
- This item does not add arbitrary external network egress; the browser preview
  bridge stays same-origin routed.

## Decisions

- The current inline preview patch is allowed only for config-free preview runs.
- Templates may use `vite preview` only through config-free flows covered by e2e.

## Done When

- Preview requests preserve and expose Vite's real CORS behavior for the
  browser-routed `/preview/<port>/...` surface, or the UI/compat docs clearly
  signpost why this origin cannot be equivalent.
- E2E covers at least one header-sensitive preview request through the real
  `vite preview` CLI.

## Reversibility

REVERSIBLE playground runtime adapter behavior. No public package API changes.
