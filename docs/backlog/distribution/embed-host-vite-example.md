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

- `apps/embed-example` — Vite + React host importing only published-surface entry points of `@riftydev/sdk`/`@riftydev/workbench`/`@riftydev/react` (workspace-resolved); `check:arch` forbids playground/`src/internal/*` imports.
- Host wiring = exactly the doc's steps, nothing else: COOP/COEP headers on the route, `sw.js` build + registration, WASM asset copy, worker URLs, `registryUrl` from env (D-004).
- CI e2e (chromium) against `vite build` + preview of the example: mount → `npm install` output scrolls in `RiftyTerminal` → vite dev server LIVE in `RiftyPreview` → edit a file in `RiftyEditor` → preview updates via HMR. Assertions reuse the playground e2e oracles (LIVE state, preview readiness), isolated port per worktree.
- `docs/public/embedding.md`: every step the example needs and nothing more; honest notes — "verified on Vite; other bundlers untested", COOP/COEP route consequences for third-party content (OAuth popups, foreign iframes) with the dedicated-route recommendation, host-SW scope note, self-hosted registry requirement with `hosting-*` links.
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
- Doc lives at `docs/public/embedding.md` and is maintained against this example — drift between doc and example is a defect.
