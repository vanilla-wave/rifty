# ADR 0369: Dedicated headerless no-COI browser test lane

Status: Accepted
Date: 2026-08-29

> TL;DR: no-COI proofs run in a dedicated Playwright lane (`playwright.no-coi.config.ts` + `tests/no-coi/`, plain `node:http` server with NO COOP/COEP, real built prod bundles) — reusable by all `no-coi-sandbox-tier` slices; never bolted onto the COI e2e config.

## Context

Every existing browser lane serves COOP/COEP (crossOriginIsolated pages);
`crossOriginIsolated === false` + absent `SharedArrayBuffer` binding is
unreachable there, and stubbing the binding in a COI realm is a different realm
(`instanceof undefined` TypeError vs absent-binding ReferenceError — probe
§2026-08-29). Goal `no-coi-sandbox-tier` needs real-realm RED-first substrates
now (bare-sab-guard) and an I8 CI proof later. A reusable test topology is an
IRREVERSIBLE mechanism choice; the lane shipped at bare-sab-guard checkpoint 2
without its ADR carrier (checkpoint-4 blocker) — recorded here.

## Decision

- Dedicated Playwright config `playwright.no-coi.config.ts` (`pnpm
  test:no-coi`), testDir `tests/no-coi/`, own port; webServer = committed plain
  `node:http` static server (`tests/no-coi/server.mjs`) that sets NO
  COOP/COEP — the load-bearing property, kept structurally impossible to
  inherit from the COI e2e webServer.
- Fixtures are esbuild bundles of the REAL prod sources
  (`tests/no-coi/build-fixtures.mjs`), built at global-setup — the lane never
  exercises source copies or stubs.
- Substrate tests assert the realm preconditions (`crossOriginIsolated ===
  false`, `typeof SharedArrayBuffer === 'undefined'`) before acting — a future
  Chromium change fails loud, never silently re-scopes the lane.
- Lane is the reuse point for later tier slices (composition, CI I8 proof);
  new no-COI proofs join this lane rather than spawning parallel headerless
  servers.

Rejected: flag/param on the main e2e config (one header regression silently
flips the realm class of every test); serving fixtures from the COI dev server
(same failure mode); Node realm with deleted binding as the substrate (not the
Chromium realm — kept only as a transcript differential).

## Consequences

- Two Playwright configs to maintain; acceptable — the header split is the
  entire point.
- RED-first substrates can live in the lane before their fix lands
  (`pnpm test:no-coi` is not part of `pr:check` until the goal's I8 slice
  wires it green).
- Later slices inherit server/fixture plumbing instead of re-deciding it.
