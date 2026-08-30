---
area: toolchain-build
status: ready
title: no-COI substrate lane — headerless Playwright lane, provenance harness, required CI job, replayable evidence driver
created: 2026-08-30
why: split re-cut of runtime-js/worker-realm-compat-bare-sab-referenceerror (Contract+RED checkpoint 7, Budget blocker — expected-RED batch far above the pickup band ⇒ "the unit is too big: re-cut/split before implementation", backlog README §Goal run); the lane/evidence/CI obligations are tooling-class, separable, and GREEN today — they inflated a parity unit's checkpoint surface without being part of its one fix carrier
epic: no-coi-sandbox-tier
sources: [ADR-0369, docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, docs/backlog/runtime-js/reference/no-coi-realm-probe-transcript-2026-08-29.json]
code: [playwright.no-coi.config.ts, tests/no-coi/server.mjs, tests/no-coi/header-provenance.mjs, tests/no-coi/build-fixtures.mjs, tests/no-coi/build-provenance.no-coi.spec.ts, tools/probes/no-coi-realm-probe.mjs, .github/workflows/ci.yml, tools/checks/ci-change-scope.test.ts, tools/checks/ci-gate.mjs]
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
  required `no-coi-chromium` CI job (this item) runs every lane spec on every
  CI run. The predecessor is DRAFT (checkpoint-8 demotion) and a draft is
  never implemented, so its expected-RED batch carries NO tests on this branch
  (checkpoint 9 — the checkpoint-8 `test.fail` declared-RED encoding is
  withdrawn, ADR-0369 dated correction: no device may green a ready unit's
  REDs). When the predecessor re-compiles to ready, its Contract+RED commits
  plain RED substrate blocks on this required job, keeping that PR red until
  the fix — machine-enforced, never opt-in. This item is the job's first
  consumer, green with NO dependency on any fix, and lands serially FIRST
  (map item 1).

## Reference contract

- Realm reference: **real no-COI Chromium 148.0.7778.96** — the exact
  Playwright-pinned build (`@playwright/test` in the committed lockfile);
  mechanism: `chromium.launch()` against `tests/no-coi/server.mjs` (plain
  `node:http`, NO COOP/COEP) — lane via `pnpm test:no-coi`, replay via the
  evidence driver. Every transcript records the executable version
  (`chromium: browser.version()`); the preconditions pin rejects a drifted
  realm loud before any spec acts.
- Decode/`util:types` oracle: **Node v24.16.0** (`node` transcript field =
  `process.version` of the driver's own executable — version drift is visible
  in every regenerated transcript, review-checked against this pin);
  mechanism: the driver spawns fresh `process.execPath --input-type=module -e`
  children per row — binding intact AND `delete globalThis.SharedArrayBuffer`
  sim, real `node:util/types` imported BEFORE install for the differential
  rows.
- No semantic copies: probe fixtures are esbuild bundles of the REAL prod
  sources; the Node columns run REAL Node — a rifty-rerun-in-Node is not an
  oracle.

## Acceptance

- Headerless lane: `playwright.no-coi.config.ts` + `tests/no-coi/` served by
  `tests/no-coi/server.mjs` (plain `node:http`, NO COOP/COEP), fixtures =
  esbuild of the REAL prod sources (`build-fixtures.mjs`); run
  `pnpm test:no-coi`. "Never a source copy" is STRUCTURED, not narrated
  (a byte-identical copy under `tests/` builds byte-identical bundles and
  passes every output row): the build metafile records each of the FOUR
  bundles' `entryPoint` — pinned to the exact literal `packages/` source with
  that source among the bundle's consumed inputs; copy-path / missing-output /
  unconsumed-entry mutants throw exact messages
  (`build-provenance.no-coi.spec.ts`; the builder itself asserts and the
  driver inherits the loud throw).
- Substrate reality pinned before any spec acts (green preconditions pin in
  `worker-realm-compat.no-coi.spec.ts`): `crossOriginIsolated === false`,
  `typeof SharedArrayBuffer === 'undefined'`, shared `WebAssembly.Memory`
  constructs with `[object SharedArrayBuffer]` buffer brand — a future
  Chromium change fails loud, never silently re-scopes the lane.
  Rejection-precedes-action detection swept per violated predicate SIBLING
  (`crossOriginIsolated` forced true / SAB binding present / wrong buffer
  brand / `instanceof ArrayBuffer` true) × page AND Worker: runProbe throws
  the named precondition error with an ACTUAL realm decode-call counter
  EXACTLY 0 at rejection (spy over the real `TextDecoder.prototype.decode`
  installed before the probe — an unpatched NATIVE decode before the gate
  leaves no `__riftyShared` marker and no `/dist/` request; the import and
  marker sentinels are asserted too, but only the counter sees it).
- Header provenance on the ACTUALLY CONSUMED responses (probe row 16): harness
  capture (`tests/no-coi/header-provenance.mjs`, one authority for spec AND
  driver) records pathname + status + headers + the request's `Sec-Fetch-Dest`
  destination, and fails loud unless BOTH isolation headers are absent on
  every consumed response AND every expected (path, destination) class
  (document / Worker script incl. its static imports / dynamic module imports
  — class maps exported per caller, incl. `kernelDriver`) was consumed with
  status 200. The never-consumed and consumed-only-non-200 arms throw DISTINCT
  EXACT messages, pinned by exact string equality (a combined diagnostic
  satisfying two lazy regexes fails). Derived state lies (a one-header server
  keeps `crossOriginIsolated === false`); an in-page re-fetch sweep lies (a
  `Sec-Fetch-Dest`-keyed server serves headers only on real responses); a
  headerless sweep alone lies about classes the realm never loaded; pathname-
  only matching lies about WHO consumed (a missing or destination-only-404
  real class shadowed by an ordinary 200 `fetch(path)` would pass). Detection
  itself is pinned (`header-provenance.no-coi.spec.ts`): exact
  class→(path,dest) identity + per-set uniqueness of the exported maps (an
  aliased class shrinks no sweep silently); destination-conditional INJECTION
  controls (every unique consumed path across ALL caller sets × per header:
  the consumed response carries the injected header, an ordinary fetch of the
  same path sees none, the harness throws the exact header message);
  absent controls per caller set (page / worker / kernelDriver: real
  destination never consumed while every same path is clean-fetched with
  status asserted 200 PER PATH — a tail 404 would make the "clean same-path
  fetch" premise a silent lie — exact absent message); destination-only
  non-200 controls across document/worker/module destination kinds (server
  status-inject keyed to the real destination: the 404 IS consumed and
  recorded, the ordinary same-path fetch stays 200 — exact non-200 message);
  and an EVERY-class-position sweep (pure consumed-response records, per
  caller set × per class × {absent, non-200} with the shadowing
  ordinary-fetch row present → the exact per-class message at EVERY position,
  full record set passes whole — the browser controls each fail their
  caller's FIRST unsatisfied class, so a validator checking only the document
  plus the first non-document class passed them all while tail classes went
  absent or 404 unnoticed).
- Required CI job from this branch on: `no-coi-chromium` runs `pnpm
  test:no-coi`, feeds `CI gate` its OWN result, and is UNCONDITIONAL like
  lint — never in ADR-0323 §3's classified set: a docs-only classification
  skipping it would green a READY RED-first substrate's PR between
  Contract+RED and its fix (fault class false-fallback). The gate requires
  its `success` on EVERY outcome path — code, docs-only, classifier failure —
  swept in `ci-gate.test.ts`; event classification itself is swept as the
  executed script (push / merge_group → full gate, docs-only pull_request →
  `code=false`, `ci-change-scope.test.ts`). The exact job→script→config→gate
  chain is pinned with a sibling sweep (`ci-change-scope.test.ts`) that
  PARSES and compares exact executable values PER STEP, never substring or
  job-scoped pins (`pnpm test:no-coi || true` contains the suite command;
  only whole-value equality rejects it; a job-scoped "first env map" grep
  accepts a decoy): per gated job the ONE step executing the exact suite
  command must exist, carry NO `if:` (a disabled exact step never executes)
  and no `continue-on-error` (quoted keys parsed too); the gate's env map is
  read from the EXECUTING gate step and compared whole
  (`needs.<job>.result` per job — a sibling's result, a dropped or added
  key, a detached map all fail); detection itself is pinned by a semantic
  mutant sweep over the REAL workflow (disabled exact step + quoted
  `'continue-on-error'` per gated job AND the gate, gate env detached to the
  checkout step — each must throw). Package scripts compared as whole
  executable strings; config hops read from the IMPORTED config objects
  Playwright executes — testDir AND `globalSetup` AND the webServer command
  (`node tests/no-coi/server.mjs` — an alternate headerless server fails) AND
  no `testMatch`/`testIgnore`/`grep`/`grepInvert` narrowing; discovered spec
  identity pinned by executing `playwright --list` through the real config
  (exact committed spec-file set); the globalSetup→builder hop EXECUTED with
  its metafile provenance asserted. An opt-in lane never closes acceptance
  (DoD). The job is green because this item carries only its own green pins
  (the predecessor is draft and carries no tests — see Challenge; ADR-0369
  correction), so this item is serially landable with the job green on
  landing.
- Replayable evidence driver: `node tools/probes/no-coi-realm-probe.mjs`
  regenerates the whole probe table (Chromium page+Worker × direct/aggregate,
  node v24.16.0 oracle + absent-binding sim + real `node:util/types`
  differential, kernel PUBLIC-entry sweep) into the committed transcript.
  Node-oracle provenance is structured per sibling child (binding intact AND
  deleted): the namespace handed to runProbe as `nativeUtilTypes` must be
  per-predicate `===` the child realm's `node:util` `.types` — a rifty
  util-types build substituted as "the Node oracle" throws in the child and
  fails the driver golden; the verdict rides the transcript
  (`nativeUtilTypesProvenance`).
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
   combo + the kernel page, matched by (path, destination).
3. class-map identity pin — exact class→(path,dest) maps + per-set uniqueness
   (1 green test).
4. injection controls — 7 unique consumed paths (incl. kernel bundles) ×
   {coop, coep}: caught on consumption with the exact header message,
   invisible to ordinary fetch (14 green tests).
5. absent controls (row 16) — per caller class set (page / worker /
   kernelDriver): real destination never consumed + clean same-path fetches
   with status asserted 200 PER PATH → exact absent message (3 green tests; a
   pathname-only match passes the run whole — mutation-verified RED).
6. destination-only non-200 controls (row 16) — document / worker / module
   destination kinds across the caller sets: dest-keyed status-inject 404 IS
   consumed + clean same-path 200 fetch → exact non-200 message (4 green
   tests; same mutation kills them). Absent/non-200 messages mutually
   exclusive by exact compare.
7. every-class-position sweep — pure records, per caller set × per class ×
   {absent, non-200} + shadow fetch row → exact per-class message at EVERY
   position, full set passes (3 green tests, 24 failing positions; kills a
   first-non-document-only validator every browser control passes).
8. precondition-rejection detection — per violated predicate sibling
   (coi/sab/brand/instanceof) × page+worker: named rejection message, decode
   counter EXACTLY 0, marker unset, no `/dist/` request (8 green tests).
9. fixture provenance — literal `packages/` entrypoint mapping pin + metafile
   green + copy-path/missing/unconsumed mutant throws with exact messages
   (3 green tests, `build-provenance.no-coi.spec.ts`).
10. CI mapping sibling sweep — `ci-change-scope.test.ts` (vitest): parsed
    step-scoped exact values + semantic YAML mutant sweep (disabled step /
    quoted continue-on-error / detached gate env) + event classification
    sweep + no-coi unconditional pins + imported-config topology
    (globalSetup / webServer command / no narrowing knobs) + `playwright
    --list` discovered-spec identity + executed globalSetup builder hop;
    gate outcome sweep in `ci-gate.test.ts` (no-coi success required on
    code / docs-only / classifier-failure paths).
11. kernel public-entry goldens (row 12) — driver replay throws loud on drift:
    removed export, success, wrong OR fabricated error (instanceof/prototype/
    constructor), nonzero per-entry or TOTAL Worker constructions.
12. node-oracle util/types provenance — both sibling children (binding intact
    + deleted) record `nativeUtilTypesProvenance: true` (per-predicate `===`
    vs the child realm's `node:util` `.types`), driver golden throws on
    anything else.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| substrate lane × served response headers | BOTH COOP and COEP absent on every CONSUMED (path, destination) class; loud DISTINCT exact throws on any present header, never-consumed class, or consumed-only-non-200 class, at EVERY class position with clean-fetch statuses asserted 200 per path (`provenance-lie` killed six ways: derived-state, re-fetch observation, headerless-but-never-loaded, pathname-only-shadowed-by-fetch, first-classes-only validation, tail-404 clean-fetch premise) | preconditions pin + identity pin + injection + absent + dest-only-non-200 controls + every-class-position sweep |
| substrate lane × violated realm precondition | loud NAMED rejection BEFORE any built-module import, install, or decode — per predicate sibling × page+worker, actual decode counter EXACTLY 0 (`frozen-assumption` record-then-act killed; `observable-order` native-decode-before-gate killed — marker/request sentinels alone are blind to it) | precondition-rejection detection pins |
| fixtures × build provenance | each of the four bundles' metafile entryPoint = its literal `packages/` source, entry among consumed inputs; loud exact throw on copy-path / missing / unconsumed mutants (`provenance-lie` byte-identical-copy killed) | fixture provenance pins + builder/driver internal assert |
| CI × job wiring | `no-coi-chromium` runs exactly `pnpm test:no-coi` → `playwright.no-coi.config.ts` (globalSetup + webServer command + no narrowing knobs + discovered-spec identity) → `tests/no-coi`, no `continue-on-error` (quoted parsed too), no `if:` on the executing step, gate consumes its own result from the env map ON the executing gate step — every hop a parsed step-scoped exact executable value, `\|\| true`, substring pins, disabled steps, and detached env maps rejected; detection pinned by the semantic mutant sweep (`provenance-lie`/`false-fallback` killed) | CI mapping sweep + mutant sweep |
| CI × docs-only classification | `no-coi-chromium` UNCONDITIONAL (never in ADR-0323 §3's classified set); gate requires its `success` on code, docs-only, AND classifier-failure paths — a skipped result never passes (`false-fallback` killed: a docs-only commit cannot green a READY RED-first substrate's PR) | gate outcome sweep + event classification sweep + unconditional-job pins |
| driver replay × kernel sweep | function export + ACTUAL realm ReferenceError (instanceof/prototype/constructor — `lossy-aggregate` name/message projection killed) + zero Worker constructions per entry AND in TOTAL across import/setup/calls (`observable-order` between-entries blindness killed), loud throw otherwise (`provenance-lie` killed) | kernel goldens |
| driver replay × node oracle | `nativeUtilTypes` per-predicate `===` the child realm's `node:util` `.types` in BOTH binding-intact and binding-deleted children, loud child throw + driver golden otherwise (`provenance-lie` rifty-rerun-as-oracle killed) | node-oracle provenance goldens |

## Out of scope

- The TextDecoder shim behavior contract, its expected-RED batch, and COI
  vitest pins — predecessor unit
  `runtime-js/worker-realm-compat-bare-sab-referenceerror` (DRAFT: none of it
  carries tests on this branch — checkpoint 9; verbatim batch in
  `runtime-js/reference/bare-sab-guard-pre-demotion-2026-08-30.md` + git
  history, returns at its ready re-compile).
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
  (destination-conditional header inject — checkpoint 7; status inject —
  checkpoint 8, destination-keyed since checkpoint 9: the dest-only-non-200
  controls need the REAL consumer served non-200 while the same-path fetch
  stays 200).
- Checkpoint-8 re-cut (same branch, batch with the predecessor): harness
  never-consumed/non-200 arms split with distinct messages + per-caller
  detection controls (a positive-and-injection-only pin set left both arms
  deletable unnoticed); kernel goldens strengthened to actual-error identity +
  total-zero Worker counter; serial landability established via the
  predecessor's runner-declared RED batch (see Challenge) — map cycle killed,
  this item is map item 1 and lands first.
- Checkpoint-9 re-cut (same branch, lineage carries): `## Reference contract`
  added (external oracles were pinned only in Context/driver — README §Shape
  requires the section). Consumption matching re-based from pathname-only to
  (path, `Sec-Fetch-Dest` destination) — a missing or destination-only-404
  real class shadowed by an ordinary 200 fetch passed; absent/non-200 arms
  pinned by EXACT mutually exclusive messages (two lazy regexes accepted one
  combined diagnostic); controls re-cut to combine each bad/absent real
  destination with a clean same-path fetch, swept across
  document/worker/module destination kinds + all three caller sets, plus the
  exact class-map identity pin and the injection sweep widened to every
  unique consumed path (kernel bundles now built by `build-fixtures.mjs`, one
  authority). CI sweep re-based from substring pins to parsed exact
  executable values (forbidden source-grep class; `pnpm test:no-coi || true`
  passed the old pin). The checkpoint-8 declared-RED (`test.fail`) device is
  WITHDRAWN with the predecessor's demotion — its batch and COI vitest pins
  left the branch (a draft is never implemented; ADR-0369 dated correction
  records the red-until-fix consequence binding ready substrates). Frozen
  transcript excluded from Biome formatting (driver-owned byte-identity,
  precedent: npm-11 probe output).
- Checkpoint-10 re-cut (same branch, lineage carries; batch also merged
  origin/main back in — the goal branch had fallen behind the landed
  installer decomposition + process re-cuts, making raw-comparison reviews
  read landed work as deletions). Additions only: fixture provenance made
  structural (build metafile entryPoints + mutant throws) and the Node oracle
  siblings identity-checked against real `node:util` `.types`; header
  detection extended with the every-class-position pure sweep + per-path
  clean-fetch 200 asserts; precondition rejection swept per predicate
  sibling with an actual decode counter (marker/request sentinels alone were
  blind to an unpatched native decode before the gate); CI sweep re-based to
  STEP-scoped parsing with a semantic mutant sweep (disabled exact step,
  quoted `continue-on-error`, detached gate env), config topology + `--list`
  discovered-spec identity + executed globalSetup hop pinned;
  `no-coi-chromium` made UNCONDITIONAL and gate-required on the docs-only
  and classifier-failure paths (docs-only classification could green a READY
  RED substrate between Contract+RED and fix — false-fallback); root
  CHANGELOG entry added for the reversible lane+CI delivery. Transcript
  regenerated same command (Chromium 148.0.7778.96 / node v24.16.0) — field
  diff vs frozen: the two `nativeUtilTypesProvenance` rows only.

## Reversibility

REVERSIBLE — test infrastructure + CI wiring; ADR-0369 records the lane
choice.
