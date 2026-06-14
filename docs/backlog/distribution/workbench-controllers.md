---
area: distribution
status: active
title: EPIC C — @riftydev/workbench headless UI controllers (C1-C3)
created: 2026-06-08
why: playground glue/* is already framework-agnostic but locked inside the app; lifting it into a package would let non-Solid consumers reuse the logic (DD-3) — deferred until a non-Solid consumer is concretely pulled
user_story: As a dev embedding rifty in a non-Solid app, I want headless controllers (`createEditorSync`/`createPreviewBinding`/`createRuntimeSession`) from `@riftydev/workbench` to wire editor-sync, HMR, npm-shell and preview myself, but today that glue is locked inside the Solid playground app — no reusable package.
sources: [DD-3, EPIC C, ADR-0003 (D-002), ADR-0139]
---
## Context
`apps/playground/src/glue/*` (sync-mirror-vfs, hmr-bridge, npm-shell-command, preview-bridge-wiring, templates, …) was already framework-free but app-local. EPIC C lifted the reusable pieces into `@riftydev/workbench` (L2). The default project worker runtime and headless terminal session/persistence controllers are now package-owned too; Monaco/xterm/Solid UI and bundler asset URLs stay playground-owned. DD-3 is ratified by ADR-0139.

## Shipped
- C1: moved reusable `glue/*` + templates → `@riftydev/workbench`; no upward imports into playground.
- C2: added controller APIs `createEditorSync`, `createPreviewBinding`, `createRuntimeSession`; default session config requires only `bootstrapWorkerUrl`.
- C3: repointed playground runtime/template/editor/preview wiring to consume workbench; playground keeps UI and host/bundler-specific assets.
- C4: moved the default project Worker runtime to `@riftydev/workbench/project-worker`; playground's worker entry is only a bundler asset adapter.
- C5: moved headless terminal session/persistence controllers to `@riftydev/workbench`.

## Reversibility
IRREVERSIBLE: new package + public controller API (cross-package surface) recorded in ADR-0139.
