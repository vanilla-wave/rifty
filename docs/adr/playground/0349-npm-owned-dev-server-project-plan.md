# ADR 0349: npm-owned dev-server project plan

Status: Accepted
Date: 2026-08

> Correction (2026-08-11, ADR-0355): Decision 6's default-host clause is
> replaced for deployed Playground pages only. The visible webpack config
> allow-lists the exact browser hostname; the generic plan/runtime boundaries
> and all other stock webpack defaults remain unchanged.

> TL;DR: Playground may define an exact `npm-dev-server` project whose
> manifest owns `scripts.dev`; Workbench runs `npm run dev` and discovers its
> correlated preview without a tool name, entry path, or declared port.

## Context

The original webpack-dev-server starter in PR #122 was built on a direct
tool-specific bootstrap. Since then Workbench has one project definition,
owner runtime, installed-bin shell path, and preview registry. Reintroducing a
webpack worker or treating webpack as Vite/Node would duplicate those owners
and require a false entry path or fixed runtime port.

The remaining seam question is how a real npm project whose package script
owns a long-running HTTP/WebSocket server enters that pipeline. Copying the
script body into a Workbench command field would split authority from the
exact `/package.json` bytes that npm executes. General launch/readiness
descriptors would expose orchestration choices every starter author does not
need and allow invalid combinations.

## Decision

1. The public Playground plan union adds exactly:
   `NpmDevServerPlaygroundPlan = PlaygroundPlanBase &
   { kind: 'npm-dev-server' }`. It has no command, binary, entry path, port,
   host, readiness regex, or webpack field.
2. Definition construction requires an exact `/package.json` with a non-empty
   string `scripts.dev`. Those bytes remain the sole script-body authority and
   participate in identity. Page and owner exact-key validation, cloning, and
   identity recomputation extend to the new discriminant.
3. The owner runtime runs root-pinned `npm run dev`. Existing npm nested-shell
   execution resolves the installed `.bin`; existing owner-token and PTY-run
   correlation admits the first routed preview. HTTP proof, WebSocket bridge,
   cancellation, and child-tree retirement remain generic.
4. The owner package config for this kind carries neither `entryPath` nor
   `port`. No webpack condition is added to shell, process, preview, or worker
   code.
5. App-local `NpmDevServerProjectSpec` owns manifest synthesis through
   `devCommand` and extra files. `ProjectSpecBase.packageType` defaults to
   `module`; `false` omits `type`, allowing the ordinary CommonJS
   `webpack.config.js` carried by this starter.
6. The webpack starter uses ordinary `webpack serve`, its default host and
   hash behavior, `publicPath: 'auto'`, webpack-dev-server's stock WebSocket
   client, and the preferred port only in visible webpack configuration. No
   Rifty-only CLI flag or webpack compatibility branch is permitted.

## Proof contract

- Unit contracts prove exact public/owner shapes, manifest-script validation,
  clone/identity rejection, root-pinned `npm run dev`, generic preview
  correlation, and absence of fake entry/port fields.
- Registry/preset contracts prove exact ordinary webpack files, dependencies,
  script, CommonJS manifest shape, and visible configuration without hidden
  platform workarounds.
- Development and production Chromium each cold-install the real npm graph,
  reach the routed HTTP preview, perform stock WebSocket HMR without iframe
  navigation, then reload and restart the bound project over persisted edits.

## Fault matrix

| Fault class | Required proof |
|---|---|
| provenance-lie | npm reads the exact seeded manifest; missing/malformed `scripts.dev` rejects before owner effects |
| forged-wire | extra fields and claimed identity mismatch reject at page and owner ingress |
| cross-run | readiness accepts only the current owner-token and admitted PTY run |
| stale-route | HMR and reload proof retain only the current routed preview and retire the prior run |

## Consequences

- (+) More installed npm dev servers become starter data, not platform forks.
- (+) The common caller supplies one discriminant; lifecycle and routing stay
  behind the existing deep Workbench module.
- (+) The webpack claim remains reproducible as an ordinary npm project.
- (-) `npm-dev-server` deliberately means the conventional `dev` script. A
  future arbitrary-script product contract requires a separate decision.
