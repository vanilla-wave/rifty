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
- The lane is a REQUIRED CI job from its first consumer's PR onward
  (`no-coi-chromium` + `CI gate` in `ci.yml`, wired at bare-sab-guard
  Contract+RED): RED-first substrates keep that draft PR red until the fix
  flips them green — an opt-in lane never closes acceptance (DoD). Local
  `pr:check` stays browser-lane-free like every Playwright lane
  (`tools/checks/pr-check.mjs` boundary). Goal I8 extends the lane's coverage
  to I1–I7; it does not first wire it.

> Correction 2026-08-30 (no-coi-substrate-lane checkpoint 9): the lane's
> mechanics/CI wiring split to `toolchain-build/no-coi-substrate-lane`, which
> is the job's first consumer and lands GREEN (own pins only);
> bare-sab-guard demoted to draft and its expected-RED batch left the branch
> with it — a draft is never implemented. Red-until-fix binds a READY
> RED-first substrate: from its Contract+RED commit the required job stays
> red until its fix lands. No declared-RED (`test.fail`) encoding may green a
> ready unit's REDs between slices — that checkpoint-8 device is withdrawn.

> Correction 2026-08-30 (no-coi-substrate-lane checkpoint 10): the required
> job is UNCONDITIONAL — never in ADR-0323 §3's docs-only classified set, and
> `CI gate` requires its success on every path (code, docs-only, classifier
> failure). A docs-only classification skipping it would green a READY
> RED-first substrate's PR between Contract+RED and its fix (false-fallback).
- Later slices inherit server/fixture plumbing instead of re-deciding it.
