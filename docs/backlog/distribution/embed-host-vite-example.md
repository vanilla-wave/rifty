---
area: distribution
status: ready
title: Reference embed host — Vite React app + embedding doc + CI e2e
created: 2026-07-10
why: the "embeds into an existing app" claim is unproven until a host that is NOT the playground runs the full dev-loop from published-surface packages; this app is also the source of truth for the embedding doc
user_story: As a SaaS developer evaluating rifty, I want a working reference host + a host-setup doc where every step is verified, but today the only consumer is the playground itself.
epic: embeddable-dev-loop
blocked_by: [distribution/react-bindings]
---

## Context

A plain Vite + React app in `apps/` (private, never published) standing in for the SaaS. It is the epic's acceptance vehicle: consumes only the published surface, carries exactly the host wiring the doc prescribes. e2e runs against the BUILT bundle — the prod-bundle worker dual-copy class only appears there, never in dev.

## Acceptance

- `apps/embed-example` — Vite + React host importing `@riftydev/workbench` only through its root and documented worker subpaths, plus published `@riftydev/react`/service-worker/WASM assets; `check:arch` forbids playground, lower glue, and `src/internal/*` imports.
- Host composition root contains every Vite-specific query import (`?worker&url`, `?url`) and builds exact `WorkbenchDeployment`; Workbench contains none. The host also supplies required `packageAcquisition.registryUrl`, optional direct `eddy`, and explicit `StoragePolicy` (D-004).
- CI e2e (chromium) against `vite build` + preview of the example: mount → registry-backed install output scrolls in `RiftyTerminal` → Vite run reaches SW-proven LIVE preview → conditional editor save reflects durably → preview updates via HMR → files CRUD/terminal close/project close leave no route or worker. Assertions reuse the playground oracles, isolated port per worktree.
- Embedding doc (`embedding.md` in `docs/public/`): every step the example needs and nothing more; exact `deployment`/`packageAcquisition`/`storage` shapes; honest notes — "verified on Vite; other bundlers untested", COOP/COEP route consequences, origin-wide single-Workbench claim, SW scope, and self-hosted registry/Eddy links.
- Final consumer test builds and packs the first-party closure, installs tarballs without workspace resolution, builds this Vite host, then runs the Chromium flow. A workspace-resolved app alone cannot close acceptance.
- New-dir tooling wiring complete if the app lands outside existing globs (workspace, vitest, check:arch, backlog SCAN_ROOTS — see services/ precedent).

## Parity cases

None — packaging/integration item. Oracle = the e2e above asserting the same observable flow the playground pins.

## Out of scope

- Next.js / webpack host examples — doc carries the honest "untested" note; new draft only when a real embedder pulls it.
- Publicly deploying the example.
- Scaffolding new apps (`distribution/create-rifty-template`).
- iframe embed tier (`distribution/iframe-embed`).

## Decisions

- Location `apps/` (private) — reuses existing app tooling globs; NOT a template repo.
- e2e runs against the built bundle (catches the prod worker dual-copy class); lane placement follows the existing chromium lane split.
- Doc lives at `embedding.md` in `docs/public/` and is maintained against this example — drift between doc and example is a defect.
