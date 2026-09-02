# ADR 0355: Webpack starter trusts the exact deployed hostname

Status: Accepted
Date: 2026-08
Relates to: ADR-0349, ADR-0354

> TL;DR: the webpack starter visibly allow-lists only the browser page's exact
> hostname, while Workbench and the WebSocket bridge remain generic.

## Context

ADR-0349 kept the webpack starter on ordinary `webpack serve` defaults, and
ADR-0354 preserved the browser-owned Origin across the preview bridge. That is
sufficient on localhost because webpack-dev-server always admits localhost,
but not on a deployed Playground hostname. On the PR Netlify alias, HTTP
preview succeeded while webpack-dev-server 5.2.6 rejected its stock HMR open
with `Invalid Host/Origin header`: the truthful Host and Origin named an exact
hostname absent from webpack-dev-server's default allow-list.

Rewriting either header would lie about browser provenance. Allowing every host
would remove webpack-dev-server's DNS-rebinding defense. Passing deployment
policy through the public project plan or Workbench would make a generic
runtime own one starter's visible configuration.

## Decision

1. The Playground webpack template resolves the browser-owned
   `globalThis.location.hostname` once when it materializes the starter. Node
   registry tooling uses an explicit `localhost` fixture; a browser location
   without a hostname fails loudly.
2. The ordinary CommonJS webpack config carries
   `devServer.allowedHosts: [<exact hostname>]`. The value is hostname-only and
   JSON-serialized. Wildcards, suffixes, `all`, and hard-coded deployment
   domains are forbidden.
3. All other ADR-0349 boundaries remain: the public `npm-dev-server` plan has
   no host/port/webpack field; `/package.json` owns `scripts.dev`; the owner runs
   root-pinned `npm run dev`; preview correlation, HTTP, WebSocket, cancellation,
   and retirement remain generic. The starter retains stock webpack client,
   default bind/hash behavior, `publicPath: 'auto'`, and its visible preferred
   port.
4. ADR-0354's exact browser Origin remains authoritative. A singleton project
   allow-list is not an Origin/Host bypass; rewriting provenance or using an
   unbounded allow-list remains forbidden.

## Proof contract

- Registry and plan contracts pin exact rendered config, a zero-field generic
  Workbench plan, and absence of unbounded or deployment-specific escapes.
- Gating Chromium runs the real starter under a reserved non-local HTTPS page
  hostname, cold-installs webpack, reaches routed HTTP, and completes stock
  no-navigation HMR. Local development and production-artifact journeys remain
  in the sweep.
- The deployed PR alias supplied the external RED and is rechecked after push;
  the deterministic non-local HTTPS carrier owns durable acceptance.

## Fault matrix

| Fault class | Required proof |
|---|---|
| frozen-assumption | non-local Chromium hostname reaches stock HMR; localhost-only acceptance cannot close the claim |
| provenance-lie | rendered allow-list equals `location.hostname`; Host and Origin remain browser-owned and unmodified |
| corrupt-input | empty browser hostname fails loudly before starter materialization |

## Consequences

- (+) Hosted stock HMR keeps webpack-dev-server's DNS-rebinding protection.
- (+) Deployment knowledge stays in the visible starter file rather than a
  Workbench/runtime interface.
- (-) An existing user-owned project keeps its saved config; choosing or
  resetting the starter materializes the current hostname.
