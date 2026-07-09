---
area: playground
status: ready
title: Vite preview CORS/header parity over the browser preview bridge
created: 2026-06-28
why: `vite preview` runs the real installed CLI on the user's config — rifty no longer force-disables preview CORS or guards config presence (both were pre-flight config validation, the wrong layer). Response headers and same-realm/external proxy already flow through the SW bridge; the open parity question is whether observable CORS/header behavior matches real Vite, given the Origin the middleware sees is the playground origin, not direct localhost.
user_story: As a developer using `vite preview` in rifty, I want preview HTTP headers and CORS behavior to match real Vite where observable, or a loud execution-boundary throw / signpost instead of a silent sandbox-only divergence.
sources: [ADR-0173, ADR-0189, docs/backlog/playground/vite-preview-origin-isolation-signpost.md]
code: [apps/playground/src/workers/vite-cli-prep.ts, packages/service-worker/src/route-preview.ts, tests/e2e/vite7-build-preview.spec.ts]
---

## Context

`vite preview` runs through the real installed Vite CLI. rifty does NOT touch its
config or CORS anymore — the old `cors:false` cli.js source patch AND the
config-presence guard (`NotImplementedError('vite.preview.config-loading')`) were
retired as the wrong layer (a pre-flight guess about config that WILL run,
instead of a throw at the execution boundary of an unsupported op). Preview
traffic is served same-origin at `/preview/<port>/...` through the Service Worker
bridge, which:

- forwards response headers verbatim — user `preview.headers` pass through; rifty
  only fills COEP/CORP when absent (host cross-origin-isolation requirement);
- rewrites the request Host to `localhost:<port>` — `preview.allowedHosts`/host
  checks see a faithful value (ADR-0189);
- routes same-realm loopback + external `fetch` for `preview.proxy`; a target the
  bridge cannot reach (cross-realm loopback, raw socket) loud-throws at the net
  boundary (`net.Socket.connect` NotImplementedError), never a silent hang.

The one residual shape difference: vite's CORS middleware reads the request
Origin, which over the bridge is the playground origin, not direct
`localhost:<port>`. That is a platform-origin difference (signpost item), not a
functional break — the preview iframe is same-origin, so the browser does not
enforce CORS on it.

## User scenario

A developer builds a Vite app in rifty, runs `vite preview` on their own
`vite.config.*`, and inspects headers from the preview iframe or a same-origin
fetch. Observable CORS/host behavior should match real Vite where the bridge can
model it; where it cannot (Origin), the UI/docs signpost the platform difference
rather than making template-specific behavior look portable.

## Acceptance

- `vite preview` runs the real CLI on the user's config (incl. a template-owned
  `vite.config.js`) with NO rifty preview-config guard and NO forced `cors:false`
  (verified today by `vite7-build-preview.spec.ts` running without `rm`).
- Observable CORS/header behavior through `/preview/<port>/...` is byte-for-byte
  equivalent to direct Vite preview where the bridge models it (headers,
  Host-based checks), or the Origin/isolation difference is signposted
  (`vite-preview-origin-isolation-signpost`) — never a silent divergence.
- A `preview.proxy` target the bridge cannot reach loud-throws at the net
  execution boundary, not a silent readiness hang.

## Parity cases

- Compare direct Node/Vite `preview` response headers with the rifty bridge for a
  static asset and an HTML document, incl. a user `preview.headers` entry.
- A user `preview.cors` config runs the real middleware; assert the emitted CORS
  headers and that the Origin-shape difference is the ONLY divergence.
- A `preview.proxy` to a same-realm loopback port serves proxied bytes; a
  cross-realm / raw-socket target throws a Node-shaped net error.

## Out of scope

- Making the browser URL literally `http://localhost:<port>/` (the SW cannot own
  arbitrary loopback origins) — tracked by the origin-isolation signpost.
- Non-Chromium browser parity.

## Decisions

- rifty runs the real preview middleware; it does not pre-scan config or force
  options. Divergences are either faithful, signposted, or a loud execution
  throw — never a silent lie and never a pre-flight config guard.

## Reversibility

REVERSIBLE playground runtime adapter behavior. No public package API changes.
