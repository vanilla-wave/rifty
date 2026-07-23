---
area: playground
status: ready
title: Vite preview CORS middleware parity over the browser preview bridge
created: 2026-06-28
why: Installed Vite loads preview config normally, but the browser bridge changes the observable origin/Host shape; `preview.cors` and `preview.allowedHosts` lack direct-Node differential proof.
user_story: As a developer using `vite preview` in rifty, I want preview HTTP headers and CORS behavior to match real Vite where observable, or to see a loud tracked ceiling instead of a silent sandbox-only divergence.
sources: [ADR-0173, ADR-0174]
code: [packages/workbench/src/workers/vite-cli-prep.ts, tests/e2e/vite7-build-preview.spec.ts]
---

## Context

Installed `.bin/vite` owns preview args and root/`--config` loading. Requests
reach it through the same-origin Service Worker/owner bridge at
`/preview/<port>/...`, not a direct browser connection to
`http://localhost:<port>/...`. The remaining gap is observable header/host
parity, not config loading or a Vite source patch.

## User scenario

A developer builds a Vite app in rifty, runs `vite preview`, and inspects
headers from the preview iframe or a same-origin fetch. The observable CORS and
host behavior should match real Vite preview where the browser bridge can model
it; if not, rifty must fail loudly instead of making template-specific behavior
look portable.

## Acceptance

- `vite preview` with root or `--config` reaches the real installed CLI and
  registers its actual production preview port.
- Direct Node/Vite vs rifty differential tests cover `preview.cors` and
  `preview.allowedHosts` for HTML and static assets.
- CORS/host header behavior through `/preview/<port>/...` is either byte-for-byte
  equivalent to the direct Vite preview server where observable, or documented as
  an explicit compat limitation.

## Parity cases

- Compare direct Node/Vite `preview` headers with rifty preview bridge headers
  for a static asset and an HTML document.
- Cover a user config that changes `preview.cors` / `preview.allowedHosts`; rifty
  must honor the same observable headers or publish an explicit bridge limitation
  without rejecting config loading.

## Out of scope

- This item does not add arbitrary external network egress; the browser preview
  bridge stays same-origin routed.

## Decisions

- Do not patch Vite or reject user config to hide bridge differences; adaptation
  belongs at the generic preview boundary.

## Done When

- Preview requests preserve and expose Vite's real CORS behavior for the
  browser-routed `/preview/<port>/...` surface, or the UI/compat docs clearly
  signpost why this origin cannot be equivalent.
- E2E covers at least one header-sensitive preview request through the real
  `vite preview` CLI.

## Reversibility

REVERSIBLE playground runtime adapter behavior. No public package API changes.
