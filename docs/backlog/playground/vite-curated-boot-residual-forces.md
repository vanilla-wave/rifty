---
area: playground
status: ready
title: Delete or narrow legacy direct Vite boot forced config
created: 2026-07-08
why: PR #112 retires `base`/`appType`/`host`/`strictPort` from the shell/.bin Vite wrapper path, but legacy direct boot modules and template specs still carry those forces, making "retired" claims ambiguous.
user_story: As a developer and maintainer, I want rifty's Vite-specific glue to be either on a live user path with an honest contract or deleted, but today old direct boot config still looks like active Vite policy after the shell/.bin path moved on.
epic: preset-deglue
blocked_by: []
sources: [docs/backlog/net/preview-websocket-bridge.md, docs/adr/net/0189-preview-loopback-websocket-bridge.md, docs/adr/service-worker/0097-preview-frame-port-context-routes-root-relative-requests.md]
code: [apps/playground/src/templates/project-spec.ts, apps/playground/src/workers/dev-server-boot.ts, apps/playground/src/workers/build-boot.ts]
---

## Context

The current user-facing Vite dev/preview commands route through the shell's `.bin/vite`
executor, `node-entry-bootstrap`, and `vite-cli-prep`. That path no longer forces
`base: './'`, `appType: 'spa'`, `server.strictPort`, or `server.host`.

Residual direct Vite paths still compile and are unit-pinned:

- `ServerSpec` still carries `appType`, `strictPort`, `host`, and `allowedHosts`.
- `bootDevServer` still passes `base: './'`, `server.strictPort`, `server.host`, and `appType` to `createServer`.
- `bootPreview` still passes `preview: { port, strictPort: true, host: true }`.

Those may be legacy/curated paths, but while they stay in source they must not be
described as globally retired.

## Acceptance

- Classify every residual direct Vite boot path as either live or obsolete.
- If obsolete, delete the path and its tests; the shell/.bin path remains the only Vite dev/preview path.
- If live, narrow the config to the same honest residual set as the shell/.bin path, or document why that path intentionally differs.
- `ServerSpec` no longer carries retired Vite-only knobs unless a live consumer needs them and has a test proving why.
- PR/docs wording can say globally retired only after this item lands; until then it must say "retired from the shell/.bin Vite wrapper path".

## Parity cases

- Shell/.bin `vite dev` and `vite preview` keep using Vite's own CLI semantics.
- Any retained direct boot path must prove its observable preview behavior matches the equivalent real Vite CLI flow for the options it sets.

## Out of scope

- `server.allowedHosts`, `optimizeDeps.noDiscovery`, Vite 8 HMR-off, and preview CORS/config ceilings remain separate tracked residuals.
- This item does not require deleting `vite-cli-prep`; that waits for the remaining wrapper residuals in `net/preview-websocket-bridge`.

## Decisions

- Until this lands, PR #112's honest claim is path-scoped: retired from shell/.bin Vite wrapper path, not from all Vite-related source.
