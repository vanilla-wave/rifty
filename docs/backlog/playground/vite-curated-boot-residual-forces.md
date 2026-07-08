---
area: playground
status: ready
title: Delete or narrow legacy direct Vite boot config
created: 2026-07-08
why: the shell/.bin Vite wrapper path is deleted, but legacy direct dev/build/preview helpers still pass curated Vite config and guard user config in places, making "wrapper retired" claims ambiguous unless those paths are classified.
user_story: As a developer and maintainer, I want rifty's Vite-specific glue to be either on a live user path with an honest contract or deleted, but today old build/preview boot config still looks like active Vite policy after the shell/.bin path moved on.
blocked_by: []
sources: [docs/adr/net/0189-preview-loopback-websocket-bridge.md, docs/adr/service-worker/0097-preview-frame-port-context-routes-root-relative-requests.md, docs/adr/playground/0173-vite-7-production-build-and-preview.md, docs/adr/playground/0174-run-vite-through-installed-bin.md]
code: [apps/playground/src/workers/build-boot.ts, apps/playground/src/workers/dev-server-boot.ts, apps/playground/src/workers/vite-config-guard.ts]
---

## Context

The current user-facing Vite dev command routes through the shell's `.bin/vite`
executor, `node-entry-bootstrap`, and `vite-cli-prep`. That path no longer has a
Rifty-generated config wrapper.

Residual curated direct paths still compile and are unit-pinned:

- `dev-server-boot` calls `createServer()` directly with inline config
  (`root`, `base: './'`, `server.port`, `plugins: []`) instead of going through
  Vite's CLI.
- `bootBuild` and `bootPreview` pass `configFile: false` and loud-reject a
  project-root `vite.config.*` through `assertNoUserViteConfig`.
- `bootPreview` still passes `preview: { port, strictPort: true, host: true }`.

Those may be legacy/curated paths, but while they stay in source they must be
classified as live curated behavior or deleted.

## User scenario

A developer runs the playground's Vite dev/build/preview flows. The normal
terminal `.bin/vite` path uses Vite's own CLI semantics. Any retained direct
helper either matches the equivalent CLI behavior for config loading and preview
options, or fails loudly with an explicit tracked ceiling.

## Acceptance

- Classify the residual direct Vite dev/build/preview helpers as either live or obsolete.
- If obsolete, delete the path, `vite-config-guard`, and their tests; the
  shell/.bin path remains the only Vite dev/build/preview path.
- If live, narrow the inline config to the same honest residual set as the
  shell/.bin path, or document why that path intentionally differs.
- A project-root `vite.config.*` is either loaded like Vite's real config
  discovery or rejected with the current loud `NotImplementedError`; it must
  never be silently ignored.
- PR/docs wording distinguishes wrapper retirement from curated build/preview behavior until this lands.

## Parity cases

- Shell/.bin `vite dev`, `vite build`, and `vite preview` keep using Vite's own
  CLI semantics.
- Any retained direct boot path must prove its observable behavior matches the
  equivalent real Vite CLI flow for the options it sets or loudly names the
  unsupported config option.

## Out of scope

- Vite 8 HMR-off and preset dep-optimizer opt-outs are visible template config, not in scope.
- Vite CLI wrapper deletion is done; this item only covers curated direct helpers.

## Decisions

- Until this lands, wrapper-retirement claims refer to the shell/.bin Vite
  wrapper path, not every curated direct helper.
