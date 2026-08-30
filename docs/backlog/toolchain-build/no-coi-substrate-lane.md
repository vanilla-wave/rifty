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
  required `no-coi-chromium` CI job (this item) runs the predecessor's spec on
  every run. Its expected-RED batch is runner-DECLARED (`test.fail(true, …)`,
  checkpoint 8): each RED still EXECUTES and must fail; an unexpected pass
  fails the job LOUD, so the predecessor's fix PR must strip exactly those
  annotations to go green — the flip is machine-detected, never opt-in. This
  also breaks the checkpoint-7 cycle: the job is green with NO dependency on
  the fix, so this item lands serially FIRST (map item 1).

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
  module / built bundles / kernel bundles — class sets exported per caller,
  incl. `kernelDriver`) was consumed with status 200 — the never-consumed and
  consumed-only-non-200 arms throw DISTINCT messages. Derived state lies (a
  one-header server keeps `crossOriginIsolated === false`); an in-page
  re-fetch sweep lies too (a `Sec-Fetch-Dest`-keyed server serves headers only
  on real navigation/Worker/module responses); a headerless sweep alone lies
  about classes the realm never loaded. Detection itself is pinned
  (`header-provenance.no-coi.spec.ts`): destination-conditional INJECTION
  controls (per response class × per header independently: the consumed
  response carries the injected header, an ordinary fetch of the same path
  sees none, the harness throws) AND absent/non-200 controls per caller class
  set (page / worker / kernelDriver: a never-consumed class throws its named
  message; a REAL class path served 404 via the server's status-inject knob is
  consumed, recorded, and throws the non-200 message).
- Required CI job from this branch on: `no-coi-chromium` runs `pnpm
  test:no-coi`, feeds `CI gate` its OWN result — the exact
  job→script→config→gate chain is pinned with a sibling sweep
  (`ci-change-scope.test.ts`: exact run line per gated job, script→config,
  config→testDir, gate env←`needs.<job>.result`, `continue-on-error` absent
  workflow-wide). An opt-in lane never closes acceptance (DoD). The job is
  green between slices: successor expected-RED batches ride as runner-declared
  `test.fail` rows (executed, loud on unexpected pass — see Challenge), so
  this item is serially landable with the job green on landing.
- Replayable evidence driver: `node tools/probes/no-coi-realm-probe.mjs`
  regenerates the whole probe table (Chromium page+Worker × direct/aggregate,
  node v24.16.0 oracle + absent-binding sim + real `node:util/types`
  differential, kernel PUBLIC-entry sweep) into the committed transcript.
  Kernel sweep is GOLDEN-asserted (probe row 12): each of `createSabRing`,
  `spawnKernelWorker`, retained `createWorkerOutputState` must be a
  `'function'` export AND throw an ACTUAL realm
  `ReferenceError: SharedArrayBuffer is not defined` — instanceof + prototype
  + constructor asserted in-realm, never a name/message projection (a
  fabricated `Object.assign(new Error(msg), {name:'ReferenceError'})` fails) —
  with EXACTLY zero counted `Worker` constructions per entry AND one exact
  TOTAL zero counter spanning module import, `setKernelWorkerUrl` setup, and
  all three calls (per-entry deltas alone are blind to a Worker constructed
  BETWEEN entries) — replay fails loud on removed exports, success, wrong or
  fabricated errors, or any construction.

## Parity cases

All green pins (tooling item — detection pinned, not expected REDs); rows in
`reference/no-coi-degradation-probes.md`:

1. preconditions pin (probe rows 1–2) — all four realm×install combos.
2. consumed-response header sweep (row 16) — spec beforeAll + driver, every
   combo + the kernel page.
3. injection controls — 5 classes × {coop, coep}: caught on consumption,
   invisible to ordinary fetch (10 green tests).
4. absent/non-200 controls (row 16) — per caller class set (page / worker /
   kernelDriver): never-consumed class throws its named message; a real class
   path served 404 (status-inject knob) is consumed and throws the non-200
   message (6 green tests) — deleting either harness arm fails these while
   every positive and injection pin stays green.
5. CI mapping sibling sweep — `ci-change-scope.test.ts` (vitest).
6. kernel public-entry goldens (row 12) — driver replay throws loud on drift:
   removed export, success, wrong OR fabricated error (instanceof/prototype/
   constructor), nonzero per-entry or TOTAL Worker constructions.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| substrate lane × served response headers | BOTH COOP and COEP absent on every CONSUMED response class; loud DISTINCT throws on any present header, never-consumed class, or consumed-only-non-200 class (`provenance-lie` killed three ways: derived-state, re-fetch observation, headerless-but-never-loaded) | preconditions pin + injection controls + absent/non-200 controls |
| CI × job wiring | `no-coi-chromium` runs exactly `pnpm test:no-coi` → `playwright.no-coi.config.ts` → `tests/no-coi`, no `continue-on-error`, gate consumes its own result (`provenance-lie`/`false-fallback` killed); successor declared-RED rows executed, unexpected pass fails loud | CI mapping sweep |
| driver replay × kernel sweep | function export + ACTUAL realm ReferenceError (instanceof/prototype/constructor — `lossy-aggregate` name/message projection killed) + zero Worker constructions per entry AND in TOTAL across import/setup/calls (`observable-order` between-entries blindness killed), loud throw otherwise (`provenance-lie` killed) | kernel goldens |

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
  server options beyond the injection knobs the negative controls require
  (destination-conditional header inject; unconditional status inject —
  checkpoint 8, forced by the non-200 controls needing a REAL class path
  served non-200 deterministically).
- Checkpoint-8 re-cut (same branch, batch with the predecessor): harness
  never-consumed/non-200 arms split with distinct messages + per-caller
  detection controls (a positive-and-injection-only pin set left both arms
  deletable unnoticed); kernel goldens strengthened to actual-error identity +
  total-zero Worker counter; serial landability established via the
  predecessor's runner-declared RED batch (see Challenge) — map cycle killed,
  this item is map item 1 and lands first.

## Reversibility

REVERSIBLE — test infrastructure + CI wiring; ADR-0369 records the lane
choice.
