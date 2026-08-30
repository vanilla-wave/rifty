---
area: toolchain-build
status: ready
title: no-COI substrate lane — headerless Playwright lane, provenance harness, required CI job, replayable evidence driver
created: 2026-08-30
why: split re-cut of runtime-js/worker-realm-compat-bare-sab-referenceerror (Contract+RED checkpoint 7, Budget blocker — expected-RED batch far above the pickup band ⇒ "the unit is too big: re-cut/split before implementation", backlog README §Goal run); the lane/evidence/CI obligations are tooling-class, separable, and GREEN today — they inflated a parity unit's checkpoint surface without being part of its one fix carrier
epic: no-coi-sandbox-tier
sources: [ADR-0369, docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, docs/backlog/runtime-js/reference/no-coi-realm-probe-transcript-2026-08-29.json]
code: [playwright.no-coi.config.ts, tests/no-coi/server.mjs, tests/no-coi/header-provenance.mjs, tests/no-coi/build-fixtures.mjs, tools/probes/no-coi-realm-probe.mjs, .github/workflows/ci.yml, tools/checks/ci-change-scope.test.ts]
---

## Context

The goal's first no-COI test substrate (ADR-0369), reusable by every later
slice: real Chromium on a page served with NO COOP/COEP — the only realm class
where `crossOriginIsolated === false` + absent `SharedArrayBuffer` binding is
real. Predecessor unit (split lineage, same branch):
`runtime-js/worker-realm-compat-bare-sab-referenceerror` keeps the shim
behavior contract and its expected-RED batch; THIS item owns the lane
mechanics, provenance, CI wiring, and the replayable evidence driver. All
obligations here are GREEN today (tooling-class — fault-classes §Review
convergence scopes ordinary review to documentation/CI/process/tooling work).

## Challenge

challenge: 2026-08-30 — 2 problems
- Is a zero-RED item a valid unit? Yes for this class: fault-classes §Review
  convergence scopes RED-first checkpoints to parity/stateful work;
  CI/tooling work gets one ordinary review. The lane's honest outcome is green
  pins whose DETECTION is separately pinned (injection controls, replay-golden
  loud throws) — not expected REDs.
- Does the split leave the predecessor's Final+GREEN carrier opt-in? No — the
  required `no-coi-chromium` CI job (this item) runs the predecessor's spec;
  its REDs keep the shared goal draft PR red until the fix, exactly as before.

## Acceptance

- Headerless lane: `playwright.no-coi.config.ts` + `tests/no-coi/` served by
  `tests/no-coi/server.mjs` (plain `node:http`, NO COOP/COEP), fixtures =
  esbuild of the REAL prod sources (`build-fixtures.mjs` — never a source
  copy); run `pnpm test:no-coi`.
- Substrate reality pinned before any spec acts (green preconditions pin in
  `worker-realm-compat.no-coi.spec.ts`): `crossOriginIsolated === false`,
  `typeof SharedArrayBuffer === 'undefined'`, shared `WebAssembly.Memory`
  constructs with `[object SharedArrayBuffer]` buffer brand — a future
  Chromium change fails loud, never silently re-scopes the lane.
- Header provenance on the ACTUALLY CONSUMED responses (probe row 16): harness
  capture (`tests/no-coi/header-provenance.mjs`, one authority for spec AND
  driver) fails loud unless BOTH isolation headers are absent on every
  consumed response AND every expected class (document / Worker script / probe
  module / built bundles) was consumed. Derived state lies (a one-header
  server keeps `crossOriginIsolated === false`); an in-page re-fetch sweep
  lies too (a `Sec-Fetch-Dest`-keyed server serves headers only on real
  navigation/Worker/module responses). Detection itself is pinned by
  destination-conditional INJECTION controls
  (`header-provenance.no-coi.spec.ts`): per response class × per header
  independently, the consumed response carries the injected header, an
  ordinary fetch of the same path sees none, and the harness throws.
- Required CI job from this branch on: `no-coi-chromium` runs `pnpm
  test:no-coi`, feeds `CI gate` its OWN result — the exact
  job→script→config→gate chain is pinned with a sibling sweep
  (`ci-change-scope.test.ts`: exact run line per gated job, script→config,
  config→testDir, gate env←`needs.<job>.result`, `continue-on-error` absent
  workflow-wide). An opt-in lane never closes acceptance (DoD).
- Replayable evidence driver: `node tools/probes/no-coi-realm-probe.mjs`
  regenerates the whole probe table (Chromium page+Worker × direct/aggregate,
  node v24.16.0 oracle + absent-binding sim + real `node:util/types`
  differential, kernel PUBLIC-entry sweep) into the committed transcript.
  Kernel sweep is GOLDEN-asserted (probe row 12): each of `createSabRing`,
  `spawnKernelWorker`, retained `createWorkerOutputState` must be a
  `'function'` export AND throw exactly
  `ReferenceError: SharedArrayBuffer is not defined` with EXACTLY zero counted
  `Worker` constructions — replay fails loud on removed exports, success,
  wrong errors, or any construction.

## Parity cases

All green pins (tooling item — detection pinned, not expected REDs); rows in
`reference/no-coi-degradation-probes.md`:

1. preconditions pin (probe rows 1–2) — all four realm×install combos.
2. consumed-response header sweep (row 16) — spec beforeAll + driver, every
   combo + the kernel page.
3. injection controls — 5 classes × {coop, coep}: caught on consumption,
   invisible to ordinary fetch (10 green tests).
4. CI mapping sibling sweep — `ci-change-scope.test.ts` (vitest).
5. kernel public-entry goldens (row 12) — driver replay throws loud on drift.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| substrate lane × served response headers | BOTH COOP and COEP absent on every CONSUMED response class; loud throw on any present header or never-consumed class (`provenance-lie` killed twice: derived-state AND re-fetch observation) | preconditions pin + injection controls |
| CI × job wiring | `no-coi-chromium` runs exactly `pnpm test:no-coi` → `playwright.no-coi.config.ts` → `tests/no-coi`, no `continue-on-error`, gate consumes its own result (`provenance-lie`/`false-fallback` killed) | CI mapping sweep |
| driver replay × kernel sweep | function export + exact ReferenceError + zero Worker constructions per public entry, loud throw otherwise (`provenance-lie` killed) | kernel goldens |

## Out of scope

- The TextDecoder shim behavior contract, its expected-RED batch, and COI
  vitest pins — predecessor unit
  `runtime-js/worker-realm-compat-bare-sab-referenceerror`.
- Built util-types parity (row 10/11) — a product-behavior pin, stays with the
  predecessor's parity cases (this item only hosts the lane it runs on).
- Extending lane coverage to later slices' specs — each slice brings its own
  (goal I8 extends coverage, it does not re-wire the lane).

## Decisions

- Split re-cut 2026-08-30 from
  `runtime-js/worker-realm-compat-bare-sab-referenceerror` at Contract+RED
  checkpoint 7 (same branch, lineage carries — fault-classes §Lineage: a split
  re-cut names its predecessor). Nothing weakened: every lane obligation moved
  verbatim-or-stronger; the predecessor keeps every decode/identity
  observable. Both ride the goal's single draft PR.
- Observation authority = harness capture of consumed responses (Playwright
  response events), replacing the in-page fetch sweep (checkpoint-7 blocker:
  ordinary fetches never observe navigation/Worker/module responses;
  destination-conditional one-header servers passed).
- Lane knobs stay minimal (§Simplicity): no workers/fullyParallel forcing, no
  server options beyond the injection knob the negative controls require.

## Reversibility

REVERSIBLE — test infrastructure + CI wiring; ADR-0369 records the lane
choice.
