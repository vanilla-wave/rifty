# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Review checkpoint = ultra two-pass fan-out + coverage matrix (retro of #274/#275 sessions, replay-validated on the #274 attempt-1 snapshot): reviewer runs at `model_reasoning_effort=ultra`, spawns parallel per-lens subagents, must be exhaustive in one pass; second tail pass hunts only past a settled prior-findings list; `review-schema.json` gains required `coverage` (row per Fault-matrix line / Acceptance clause / public API entry / frozen artifact, adversarial pass/weak/missing), `blockers.mjs` blocks on any non-pass row; undeclared obligation → contract re-refine, not another round (`fault-classes.md` §Review convergence).

### Added

- `docs/process/traps.md` — hard-won gotcha cache (worktrees/git, CI/PR verification, e2e, browser runtime/bundling, testing discipline, tooling wiring) + `AGENTS.md` pointer; landed from the stranded `docs/agent-traps` branch (b83415482).

### Changed

- **Goal artifact v2 + `rifty-goal` skill.** An epic is a directory
  `docs/backlog/epics/<slug>/` — frozen `goal.md`, live `map.md`, append-only
  `ledger.md` (`epics/TEMPLATE.md`); the `goal_baseline` marker,
  `check:goal-contract`, and `check:budget` retire — frozen-ness = file
  immutability, bands live in the ledger, review-owned (`rifty-review` axis 5).
  `rifty-goal` drives FIT / PICKUP / RE-CHART / CLOSE: rolling re-planning
  inside the delivery loop (probe-or-fog, JIT bands, fog graduation) and a
  closure ledger walk exporting knowledge before the goal dir is deleted.
  Drafts are typed (question | finding); declined concepts get a durable table
  (`docs/adr/README.md`); `docs/research/` gets route-or-tombstone. Active goal
  `fault-honest-sw-preview` migrated content-identically.

- **One contract gate: readiness verification = the pickup Contract+RED
  checkpoint.** The standalone fresh-context readiness judge duplicated the
  checkpoint (same fresh-context raw-contract read, weaker scope — no RED/diff)
  and charged every convergence loop twice: a 19h eval-parity session ran ~26
  judges beside 13 checkpoints finding the same blocker classes, while the
  judge-blessed item itself arrived with 3 oracle errors. §Backlog readiness
  now: compile with reproducible artifacts → `ready`; the checkpoint records
  `ready-verdict: <date> — Contract+RED @ <sha>` at pickup (the goal-run
  special case is now the general rule). The evidence gate moves to capture:
  `rifty-to-backlog` gate 5 refuses model-memory oracle claims — artifact or
  open fork. Accepted trade: a compile-only flip stays unverified until
  pickup; the demotion rule (§Backlog readiness 5) covers it.
- **`pr:check` runs its tasks sequentially.** `test:run` and `test:parity`
  each saturate every core; the concurrency pool made them time-fail each
  other (3/3 aggregate runs in the eval-parity session) while each lane passed
  alone. Pool deleted rather than phased (supersedes `d7f862bc5` by owner
  call): the heavy tasks dominate runtime, so parallelism bought seconds and
  cost green runs.
- **Gates anchor to content, not commit history.** `check:contract-drift`,
  `check:goal-contract`, `check:budget` now read one aggregate merge-base→head
  diff; commit-topology machinery (pickup inference, marker lineage walking,
  per-commit attribution, ancestor checks) is deleted. A 4-day session audit
  found the history anchors' only real catches were self-inflicted — the
  rebase-replay CHANGELOG triplication existed because the gates themselves
  forbade merge-from-main — while costing three full re-reviews of
  byte-identical trees, forced separate demotion PRs (#233→#235, #241), and
  marker-SHA squash fragility. Now: a ready contract must match merge-base
  (allowed deltas: pickup `ready-verdict:` line, exact `blocked_by:`
  subtraction, `ready`→`draft` demotion — in-PR demotion is legal, the
  §Backlog readiness 5 separate-PR mandate is gone); epic frozen fields are
  checked against merge-base, inductively frozen since bootstrap;
  `goal_baseline` is an opaque write-once run id gates never resolve — merge
  strategy and squash are irrelevant; the insertion band excludes
  `docs/backlog/**`; merge-from-main is legal. Review verdicts bind to the
  checked tree, not the commit.
- **Two context-cost gaps, both measured on real agent sessions over this repo.**
  A full audit of two 132h Codex sessions (43 and 31 compactions, 894M and 518M
  billed input tokens) found the two largest avoidable sinks, neither of which a
  bigger context window fixes. (1) `rifty-review` launched the checkpoint
  reviewer as a live process and polled its stdout every 30s, pulling the
  reviewer's OWN file reads, test runs and hook noise into the caller's window —
  ~1.3k tokens per poll, peaks at 10k, 12-24 polls per run, 15.8% of one
  session's entire bill — while the binding verdict was already on disk via
  `-o`. The documented command now redirects stdout to a log; liveness comes from
  process state (proven by 109 real polls that returned empty output and still
  reported `Process running`), and the log is read only when `verdict.json` is
  missing. (2) Reads of a file already in the window were 42-45% of all reads,
  but with a line multiplier of 1.04-1.11 — not repeats, a sliding line-number
  walk over files too big to read at once. `installer.ts` (3066 lines) took 213
  reads = 12.5% of every source-read token; top-10 files = 38%. New gate
  `pnpm check:file-size`: prod sources ≤ 800 lines, today's 48 offenders pinned
  at current size and shrink-only, real burn-down re-recorded so it cannot
  regrow. Burn-down plan:
  `docs/backlog/toolchain-build/oversized-source-burndown.md`.
- **An epic fit now ends with its marker, and the marker SHA must survive the
  merge.** Two gaps found by handing a freshly fitted epic to an agent: §Epic fit
  stopped at sign-off, so the fit PR landed without `goal_baseline` and the run
  needed a second contract-only PR — exactly the chain §Autonomous goal forbids;
  and nothing said that `check:goal-contract` re-reads the epic AT the baseline
  SHA on every later source PR (`goal-contract.mjs:366`), so squash-merging a
  bootstrap PR whose marker points at one of its own commits silently breaks
  every source PR after it. §Epic fit gains step 6 (marker in the same PR, fit PR
  = bootstrap PR) and §Autonomous goal 2 states the two safe shapes: merge-commit
  the bootstrap PR, or make the marker the branch's first commit pointing at the
  merge-base (squash-safe, correct when the epic is already landed).
  `fault-honest-sw-preview` gets its baseline here in the second shape.
- **Writing an epic up is ordinary work, not a blocked ask.** `epics/TEMPLATE.md`
  read "Invariants authored with the user … the run proves them, never writes or
  edits them", which conflated fit time with run time and turned "flesh out epic
  X" into a refine-request. New `backlog/README.md` §Epic fit orders the write-up
  (tier → invariants DRAFTED from the ratified Outcome/User scenario/Decisions →
  each checked false on main with evidence → Budget slices → user sign-off
  recorded as `invariants-signoff:`); only a statement needing unsettled scope
  goes to `rifty-refine`, and a missing signature blocks the RUN, not the write-up.
  `AGENTS.md` §Data sources routes there. Applied to `fault-honest-sw-preview`
  (`tier: robust`) and `wasi-in-browser-showcase` (`tier: works`), which now
  carry invariants + slice bands; 8 legacy epics remain
  (`process-meta/ready-epic-goal-shape-debt`).
- **TTY parity composes exact one-axis native resizes.** The oracle signal-settles GNU `stty` column/row mutations; rifty's combined frame stays separately pinned.

- **PR = one delivered behavior; process state never opens a PR.** New
  `AGENTS.md` §PR — unit of delivery: contract flips, demotions, re-cuts,
  splits, intake drafts and lineage commit into the delivering unit's branch,
  and a finding never opens a second PR. The successor-PR mandate and the
  two-checkpoint cap that forced it are deleted (`fault-classes.md` Checkpoints
  / Lineage / Contract escalation, `decision-workflow.md` §Autonomous goals 5,
  `rifty-review` §Checkpoint run, `backlog/README.md` §Budget, `epics/TEMPLATE.md`
  and 14 live item copies). Contract+RED-before-implementation and
  Final+GREEN-on-one-SHA are unchanged — only the cap on re-cuts is gone;
  escalation now re-refines the contract in place. Baseline: one autonomous run
  spent 17 PRs on ~5,000 net lines, 7 of 13 merged PRs carrying zero production
  source. The rule binds agent-initiated PRs only — a PR the user explicitly
  asks for is their call, opened with what it carries named. Still PR-scoped and
  unresolved: PR-open timing, epic bootstrap, and mid-build demotion —
  `docs/backlog/process-meta/autonomous-epic-runs.md`.
- **Docs-only PRs skip 14 unit/browser jobs.** A first-party merge-base
  classifier now treats only `docs/**` and conventional documentation files as
  non-code; everything unknown fails open to the full gate. Unit/parity,
  Chromium e2e, and browser-unit jobs skip documentation-only PRs, while
  lint/type/build, generated-compat drift, and focused docs contract checks
  still run. A stable non-matrix `CI gate` reduces applicable results for
  future branch protection; the reducer lives in a unit-tested
  `tools/checks/ci-gate.mjs`. A dead `change-scope` job fails open — heavy
  jobs run via `!cancelled()` conditions instead of silently skipping
  (fault class false-fallback). Baseline: docs-only PR #177 spent 3,091
  runner-seconds across the 14 heavy jobs.

- **PR CI wall-clock ~24m → ~5m: e2e lanes sharded, unit split.** The light
  lane (23.4m serialized: 107 tests × ~13s, `--workers=1` for owner cold-boot
  starvation) now runs as 8 `--shard=i/8` matrix jobs — each shard its own
  runner, still workers=1, so the one-cold-boot-per-machine invariant is
  untouched and serial groups travel whole into a single shard. heavy → 2
  shards; `unit-and-conformance` runs `test:run`/`test:parity` as parallel
  matrix jobs. Baseline: 4 PR runs 2026-07-22/23, light lane 19.5–24.5m ≥ 4×
  every other job. Also drops `playwright install-deps` on browser-cache hit
  (ubuntu-latest already ships chromium's shared libs via Chrome): its apt tail
  is bimodal — 11s p50 / 440s max across 12 parallel shards — and with a
  sharded matrix the max IS the wall-clock; a lib dropped by a future image
  update fails the browser launch loudly. Packed Workbench acceptance runs once
  on light shard 1 instead of once per shard. Installed external packages are
  materialized outside pnpm's store layout before `npm pack`, so the acceptance
  sees one ordinary package tree with preserved executable modes on every host.

### Added

- **Shadow-series decision set (replaces PR #160; branch kept as quarry).**
  ADR-0307 re-scopes the install-trust oracle to an install-protocol commit +
  at-open package.json/lockfile compare — extraneous `node_modules` writes
  never invalidate (probe vs real npm 11.17.0/Node v24.16.0 recorded in the
  ADR; probe PASSED, so the quarry's Vite temp-cache cluster and conditional
  slice are dead). ADR-0308 fixes the package-generic builtin
  shadow-substitution registry with optional runtime binding; ADR-0309 one
  package-tree authority; ADR-0310 Sass Pattern-1 synthesized facade over the
  exact pure-JS `sass@1.100.0` twin (differential spike evidence in the ADR).
  Epic `honest-shadow-substitutions` re-refined on fresh main
  (`tier: production`, §Budget slice bands); `check:budget` enforces
  hand-written diff bands (>1× warn, >2× fail) and the
  new-coordination-mechanisms sweep for PRs declaring `Budget-Slice:`;
  `refs:check` learns quarry ADR numbers 0249/0295–0304.
  `esbuild-substitution-strategy-reconciliation` folded into the
  `esbuild-vite-cutover` slice.

### Fixed

- **Node eval parity isolates host handled-rejection warnings.** The Node Worker
  adapter consumes its host-only `rejectionHandled` event, so deferred `-p`
  Promise inspection cannot write `PromiseRejectionHandledWarning` into guest
  stderr after the process terminal cut; `unhandledRejection` stays authoritative.

- **Node eval oracle CI no longer drifts with floating Node 24 patches.**
  Unit/parity and browser jobs that execute the frozen v24.16.0 oracle now pin
  that exact patch; a job-scoped guard rejects missing, duplicate, or floating
  pins. Eval differentials run in at-most-eight-worker cohorts while the identity
  proof retains exactly two simultaneous children, avoiding host Node's native CJS
  lexer crash without weakening coverage.

- **Autonomous-run gates keep executable Contract+RED before ready authority.**
  One tri-state path classifier now drives source pickup, contract drift,
  budget mass, and mechanism scanning. Test/fixture paths—including multi-dot
  test tails—never claim production pickup or consume the hand-written budget,
  while ordinary docs such as `test-coverage-debt.md` remain counted.

- **Goal-marker CI audits the pull-request lineage.** GitHub checks out a
  synthetic merge commit whose first parent is `main`; `check:goal-contract`
  now walks the exact event `pull_request.head.sha` while retaining the merged
  worktree for all content checks. A bootstrap marker can no longer fail CI by
  being misread as one combined merge commit, and malformed PR head identity
  fails loudly.

- Snapshot drift checks now compare canonical decompressed bytes, so valid gzip
  output from different Node/zlib platforms does not fail CI.

- **`check:arch` now sees type-only boundary violations without inventing
  runtime cycles.** The checker runs an emitted-runtime graph for exact cycle
  detection and a type-inclusive graph for layer, internal, and sealed-entry
  policy. An erased type edge can no longer bypass an import boundary or make a
  mixed type/value graph fail as a runtime cycle.
- **Eddy S3 durable store handles closure hashes containing `/`.** Yandex
  Object Storage rejects SigV4 PUTs whose canonical URI signs `%2F`; the
  store now signs the raw-slash object key while leaving `+`/`=` encoded, and
  the regression proves a client-shaped public `%2F` GET resolves to that same
  object, so standard base64 closure hashes no longer degrade to
  `x-eddy-store-durable: 0`.
- bench: the `viteReadyMs` stage marker follows real vite's own ready banner
  (`VITE vX.Y ready in N ms`) — the rifty-authored `[vite] dev server ready on
  port` line died with the generic dev-server lifecycle (PR #109), so stage
  attribution silently recorded null since then.

### Changed

- **Eddy launch headline re-measured on the real production transport.** With
  `443/udp` open on the shared security group, Chromium `auto` still negotiated
  `h2` for both production origins (`registry.rifty.dev` via the Yandex CDN and
  `eddy.rifty.dev`). The committed benchmark is now the production `auto`
  median-of-5: standard **5180ms** → eddy **2761ms** = **1.88x**. The committed
  artifact does not carry the full h2/h3 matrix evidence, so the HTTP/3
  validation item remains open and the quotable user headline is only the
  production `auto` run.
- **eddy.rifty.dev now resolves directly against npmjs.** The on-VM side-
  container A/B for express+eslint cold resolves measured the former CDN proxy
  upstream at **8.668s** median (19.269s, 8.668s, 5.265s) and direct
  `https://registry.npmjs.org` at **4.682s** median (4.232s, 4.682s, 4.792s),
  with no 429/rate-limit signal and the same closure hash. The live COI compose
  and checked-in deploy template now use direct npmjs for eddy; the browser
  standard install path still uses `registry.rifty.dev`.
- **eddy.rifty.dev now uses the S3-compatible durable bundle store.** The live
  VM carries `EDDY_S3_*` only in secret-bearing metadata, not in git. Verified
  2026-07-07: POST returned `x-eddy-store-durable: 1`; the public
  `eddy-bundles` object HEAD returned `200` with
  `Cache-Control: public, max-age=31536000, immutable`; after a VM cold restart,
  `GET /bundle/<hash>` returned the same hash with `durable=1`. The
  `eddy-cdn.rifty.dev` origin is now the bucket with CDN-added ACAO `*` and
  CORP `cross-origin`, so cacheable GET-by-hash no longer needs the VM on a CDN
  miss.

### Added

- **Backlog capture/contract split + refine altitude + epic tier.** Findings
  enter through the new `rifty-to-backlog` skill (classify → dedup → gate →
  mint; the gates from the anti-overengineering set fire at capture, not at
  refine). `rifty-refine` gains the altitude rule — Acceptance pins
  observables, never carriers; unresolvable forks settle by throwaway spike;
  direction forks (point-support vs generic, tier raise) go to their own ADR —
  retiring the mechanism-prescriptive speculative contract failure mode
  (rejected first `vite-temp-install-claim-churn` contract). Epics may declare
  `tier: works|robust|production` (validated by `backlog:check`; items
  inherit): tier × boundary model = the fault rows in scope, and a finding
  above the declared tier parks pending a tier-raise ADR instead of minting
  work. `rifty-review` gains a goal-drift axis: delivered user-visible outcome
  must equal the originating contract, and a contract-wording edit landing in
  the same PR as its implementation is treated as the contract-level "never
  edit a test to make code pass" — now also enforced mechanically by `pnpm
  check:contract-drift` (in-place edit of a ready item / ready|in-progress
  epic in the same diff as apps/packages/services source = fail; adds and
  delete-on-done closures stay normal flow). Epic hand-off hardened for
  autonomous runs: ready epics enumerate Items in dependency order with a
  substrate-first rule (shared mechanism = existing owner, first item, or
  ADR-separate), and epics handed to a run declare `## Budget` tripwires
  (scope outside ready items, contract edits, new mechanisms, review rounds,
  diff estimate) — over budget stops the run, never absorbs silently; the
  deferred orchestration/detector/trial half is recorded in
  `backlog/process-meta/autonomous-epic-runs`. Also repairs a sentence split
  mid-way by the reachability-gate insert in decision-workflow.
- **Anti-overengineering process gates.** Four rules aimed at the workbench
  retro findings (five sibling correlation engines, distributed-systems fault
  machinery on in-browser ports, 101-file unowned `glue/`): fault-classes
  §Boundary failure models (refine cites the boundary's physical fault surface,
  strikes impossible axes), §Class-kill mechanism sweep (design-time,
  codebase-wide: third copy of a coordination mechanism = defect),
  decision-workflow workspace-internal shared-primitive tier (shared helper via
  `/internal` subpath = REVERSIBLE — removes the gradient that made app-local
  copies free) + own-product reachability gate (`ready` needs a user-action
  repro path; audit findings without one stay `draft`), and `pnpm
  check:dir-owner` (source dir > 30 direct prod modules carries an owner
  README; glue/workers/builtins/commands got theirs).
- **Bench transport matrix (`pnpm bench --transport matrix`,
  perf/eddy-http3-cold-validation).** The harness PINS Chromium's transport for
  the measured remote origins (h2 = `--disable-quic`; h3 =
  `--origin-to-force-quic-on` on the registry + eddy + optional bundle hosts —
  no TCP fallback) and VERIFIES the pin with per-run evidence tied to the
  measured requests: measured-window request counts per origin + a post-window
  CDP protocol probe (`Network.responseReceived`; page-context probe shares the
  context's socket pools; runs bounded and after the sample so it never primes
  the measured connections or hangs the harness). Proof is EXACT, PER RUN and
  PER PASS: a used origin lacking the pinned protocol (`http/1.1` under an h2
  pin refuses too — the artifact labels the leg h2) or lacking any positive
  proof (`unreachable` / `unknown`), and a pinned run or pass that made no
  measured-origin request at all (vacuous probe-only evidence), each refuse
  the pass (`unmeasured` + note; evidence still recorded under
  `transportMatrix.<mode>.<phase>.transport` with phase-local
  `originProtocols` + the verbatim per-run `runs` audit list) — never a lying
  median. The top-level headline stays the `auto` eddy-vs-standard result (the
  transport real users get), while `h2` and `h3` sit beside it for the
  controlled comparison. Single-mode `--transport auto|h2|h3` stays available
  for focused diagnosis. `auto` records evidence without pinning (end-of-run
  connection class, no per-request claim).

- **Source-grep test ratchet (`pnpm check:source-grep`, epic
  playground-testable-core).** CI refuses new
  `expect(source).toContain`-style tests in apps/playground and forces the
  allowlist burn-down (opened at 15 files/888 asserts, closed at 11/141) to be
  recorded (exact-count match, both directions). Wired into `pr:check` and the
  CI lint-and-typecheck job. Review round 2: the scanner also walks the
  `tests/browser-unit` lane (`*.spec.ts` — a grep there bypassed the gate) and
  refuses a positive-count allowlist entry without a recorded `why`; the
  repo-wide sweep of pre-existing package greps is backlog
  `toolchain-build/source-grep-ratchet-repo-wide`. Review round 3: the ratchet
  keys on assertion IDENTITY, not just count — each entry also records a
  `digest` of the normalized assertion-signature multiset, so swapping one grep
  for another at the same per-file count (invisible to a count-only ratchet) is
  refused unless the entry is re-recorded (digest + why) in the same PR.
- **Browser-unit test lane (ADR-0196, epic playground-testable-core).**
  `pnpm test:browser-unit` — thin Playwright harness (`unit-harness.html`, no App
  boot) on the playground vite dev server: worker-side modules behaviorally tested
  against the REAL owner worker under COI (owner ready + pty exec + vfs-write ack +
  preview republish handshake). Own CI job; serial; isolated port.

### Fixed

- **Bench install metric un-parked from a retired terminal marker.** The
  rifty-authored `[vite] dev server ready on port` line the install leg awaited
  was retired (readiness went out-of-band with the generic dev-server
  lifecycle), so every install pass timed out at 180s — unnoticed because CI's
  bench smoke runs the cold-start leg only. The leg now waits for real Vite's
  own ready banner (`VITE vX.Y ready in N ms`), keeping
  `npmInstallToFirstViteResponseMs` honest.
- **Bench eddy pass must prove it used eddy.** A resolver-configured install can
  fall back to the standard path and still reach first Vite response. The eddy
  pass now refuses the sample unless the terminal contains `via eddy (fast)`,
  the line emitted only when `install()` returned `source: 'eddy'`.
- **Standard-path registry fetch bound is closed.** The earlier
  fault-honesty changelog entry named
  `npm-client/registry-fetch-no-progress-bound` as the remaining open
  standard-path gap; ADR-0201 and the shared npm-client `bounded-fetch`
  chokepoint deliver that item and delete it.
- **browser-unit: the restore-gate spec no longer races the 250ms slow-progress
  threshold.** The stamp rework (PR #107, ADR-0187 Corrected) removed the awaited
  OPFS drains from the instant restore path, so a fast host could finish the
  restore before the threshold and the gate's progress line never printed. The
  spec now holds the snapshot response 600ms (latency shaping only — real bytes,
  real restore path) so the gated exec provably overlaps the in-flight restore.
- **`pnpm bench` refuses a partial or foreign-server measurement.** Two Fidelity
  hardenings on the install metric: (1) a pass now records `measured` ONLY when
  ALL `RUNS` samples reached first Vite response — a partial set (e.g. 1/5 after
  flakes) is `unmeasured` with the success count, never a launch-citable thin
  median; (2) the harness fails fast if the strict port is already serving
  (a stale/foreign dev server the run would measure instead of a fresh one) and
  refuses if its own spawned dev server exited before serving.

### Added

- **Fault-honesty process kit (PR #107 retro: 19 review rounds → systemic fixes).** `docs/process/fault-classes.md` — one taxonomy (8 fault axes + honest-outcome contract + class-kill rule) mined from #107's findings; Fault tier added to the test pyramid (`docs/process/testing.md`); new cross-tool `rifty-fix` skill (root cause + class sweep + RED-first fixing discipline); AGENTS.md gains the «3+ review rounds = systemic defect» Fidelity rule and a DoD mergeability gate for infra PRs (fault-matrix rows covered + `rifty-review-loop` converged — gates, not agent opinion); `rifty-refine` + backlog TEMPLATE gain a `## Fault matrix` contract section for infra items; `rifty-review-loop` gains round-3 class escalation and fixes per `rifty-fix`. Draft epics sliced by entity (one subsystem = one implementer context): `fault-honest-build-caches` / `fault-honest-opfs-persistence` / `fault-honest-sw-preview` / `fault-honest-npm-install` / `fault-honest-boot-restore` + items `process-meta/fault-tier`, `process-meta/draft-gate-enforcement`. `fault-honest-sw-preview` refined to `ready` (first Fault-matrix contracts): `service-worker/preview-blocked-host-hang` (diagnose+fix the lost vite 403 — unblocks preset-deglue's allowedHosts retirement, now cross-referenced in `net/preview-websocket-bridge`), `service-worker/preview-dispatch-termination-chokepoint` (settle on every terminal event, parity-first synthesized errors, covers loopback http.request), `net/preview-ws-bridge-termination` (WS/HMR sockets error, never park); epic-level decisions ratified: parity-first failure UX, all three broker flows in scope. Refine round 2 then DISSOLVED three of the five epics on evidence (honest stale-check, delete-on-done): `fault-honest-build-caches` — all in-memory loader caches are already fault-proven (source-text-validated hits + invalidation tests); its one real target, the not-yet-built persistent transform cache, now carries a BINDING `## Fault matrix` inside `runtime-js/persistent-esm-transform-cache`; `fault-honest-npm-install` — pins corrupt/TTL/cap + tarball integrity-reverify already tested in #107, residual quota rows folded into the vfs completion item, standard-path fetch bound stays owned by `npm-client/registry-fetch-no-progress-bound` (`cold-npm-install-speedup`); `fault-honest-boot-restore` — corrupt-artifact degradation already proven, its unique value became one child item. `fault-honest-opfs-persistence` refined to `ready` with 4 ready children: `vfs/opfs-persist-hang-watchdog` (a never-settling OPFS op becomes a bounded ledger failure — flush/stamp gates can no longer park), `vfs/iso-git-ref-torn-write-rows` (reload mid-commit never corrupts the graph; FIFO = the pinned atomicity primitive), `vfs/persist-ledger-fault-rows-completion` (rename move-stage, mid-queue isolation, consumer-visible tarball/pins rows), `playground/reload-crash-consistency-fault-e2e` (Playwright kills the page mid install/restore/commit/save → honest reopen).
- **bench: instant-preset `pick→preview-live` metric with stage attribution.** `pnpm bench` gains a third phase (artifact schema v2): boots `--presets` instant presets (default `project-files,typescript-ls`) via the deep-link and records navigation→preview-LIVE median with per-run stages (`interactiveMs`, page-observable `viteReadyMs`); npm install is NOT in the path (baked snapshots). All runs must go live or the preset records `unmeasured` (no partial medians); `--presets none` records an explicit skip. CI smoke runs one JS preset and requires it to MEASURE (an `unmeasured` instant preset on a healthy prod stack means the boot broke — only ms stays ungated, PB-6). The committed `perf/benchmarks.json` is schema v2 and records this phase explicitly; the current production `auto` artifact used `--presets none`, so it records the phase as `skipped`.
- **Cold-start + npm-install benchmark harness (`pnpm bench`, `docs/backlog/perf/cold-start-and-install-benchmark`).** A zero-dep timing runner (`tools/perf/bench.mjs`) drives a headless Chromium tab (Playwright — already a devDep, not vitest `bench`) through the `?preset=real-vite&autorun=1` deep-link, median-of-N with a fresh browser context per run: (a) cold-start-to-interactive ms — always; (b) npm-install-to-first-Vite-response ms — only when `VITE_RIFTY_REGISTRY_URL` points at the deployed registry proxy (D-004), else recorded `requires proxy` (never silently skipped). Emits the committed `perf/benchmarks.json` a launch figure can cite (measured median, conservatively rounded up). A CI smoke gates on the harness PRODUCING a well-formed artifact — cold-start measured + the install number recorded — NOT on absolute ms (wall-clock is noisy on shared CI; PB-6). The pure aggregation core (median / conservative round-up / artifact schema) is RED-first unit-tested. When `VITE_RIFTY_RESOLVER_URL` is ALSO set, (b) runs TWO passes on the same port — a standard baseline (no resolver) then the eddy fast path — and nests the standard baseline + a measured `speedupX` under the eddy metric; a discarded warm-up run per install pass keeps the median steady-state (the first hit pays a one-off dev-server/proxy-connection cost a deployed warm server never re-pays). First real-browser measurement (live `registry.rifty.dev` + `eddy.rifty.dev`, `real-vite` preset, warm, median-of-5): standard **4284ms** → eddy **2517ms** = **1.70×** (committed to `perf/benchmarks.json`).
- **Eddy — opt-in fast npm install (ADR-0182).** New `@riftydev/eddy` design: an opt-in server that runs rifty's OWN resolution (imports `@riftydev/npm-client` — one algorithm, no drift) and returns one artifact (a v3 lockfile + the bundled compressed tarballs); the client pre-seeds its tarball cache + writes the lockfile, then the EXISTING lockfile fast path installs in one round-trip, collapsing both the latency-bound packument and tarball waterfalls (~100 round-trips → 1 POST). The ~6x (~4s → ~0.6s) was a Node/sandbox model; the first REAL-browser measurement (harness above, warm h2) was **1.70x** (standard 4284ms → eddy 2517ms) — the metric shares the ~vite-boot and the standard baseline rides a warm-proxy h2 connection, not the 4s cold path. Getting there also fixed a client bug where the lockfile fast path did not replay shadow/user overrides, so eddy's pre-seeded lockfile threw `EBROKENLOCK` on every override package (`vite` → esbuild included) — see `@riftydev/npm-client`. ADR-0182 records variant B (lockfile + compressed-tarball bundle; extracted-tree rejected), bounded staleness (TTL≤30min + `prefer-online` + as-of stamp = npm's own freshness model server-side), and supersedes `cold-npm-install-speedup`'s former `server-side-closure-resolver` + `bundled-popular-subgraph-metadata` draft items after measurement + adversarial verification.
- **Cold npm-install speedup backlog — 1 epic + 4 items.** `docs/backlog/epics/cold-npm-install-speedup`: the cheap, always-on, no-infra levers for the STANDARD install path. `npm-client/abbreviated-packuments` (corgi `Accept` header — cuts metadata BYTES ~2.5x; measured latency-bound so ~nil wall-time on a normal link, kept as a free bytes/parse win for slow/metered links), `perf/cold-install-metadata-reprofile`, `npm-client/persisted-packument-store`, `perf/install-transport-tuning` (HTTP/3 only — raising the fetch semaphore is browser-inert: one coalesced h2 connection per origin). The structural wall-time win moved to eddy (ADR-0182). Rejected levers (global OPFS CAS, ETag/304, brotli, worker-offload decompress, OPFS write consolidation, streaming SRI) recorded as out-of-scope. Sourced from a 2026-06-27 deep-research pass over `@riftydev/npm-client`.
- **Promotion / GTM backlog — 4 epics (3 ready, 1 draft) + 9 items (8 ready, 1 draft).** New `docs/backlog/epics/` for the developer-adoption push: `open-auditable-launch` (the discovery Show HN), `webcontainers-alternative-search-slot` (the verifiable compare page), `wasi-in-browser-showcase` (the one uncontested capability) — all `ready`; and `open-bolt-ai-sandbox-demo` (open client-side AI-sandbox reference) kept `draft`, since its live-preview path needs the IRREVERSIBLE `public-api-ai-agent-exec-preview` API (no ADR yet). Each maps to the product work it needs — launch deep-link, measured cold-start/npm-install benchmark, README wedge rewrite, publish `@riftydev/git`+`@riftydev/ts-language-service`, `rifty.dev/compare`, `examples/` AI-sandbox demo (draft), clickable WASI preset, standalone WASI example, `rifty.dev/blog` — and links the existing `toolchain-build/compat-matrix-test-result-sink`. Sourced from `docs/research/open-webcontainers-alternative-2026-06.md`.

### CI

- **e2e globalSetup absorbs the cold dev server's dep-optimize page reload.** The
  suite's FIRST spec against a cold `pnpm dev` (fresh runner / cleared
  `node_modules/.vite`) raced vite's dep-optimize full-page RELOAD (dev-only; a
  prod build never reloads): the reload landed mid-starter-pick, the reloaded app
  re-opened the chooser, and the spec waited 2 min for a boot that never started —
  the `cli-report` "boot output never appearing on first attempt" flake, and its
  fallout failed the next dev-server spec. Reproduced deterministically by
  clearing `.vite`; one throwaway page load in `tests/e2e/global-setup.ts` now
  absorbs the optimize cycle before any spec runs (a warm cache pays one fast
  page load). Engine-aware: the setup launches the first available engine
  (chromium → firefox → webkit) — the cross-browser workflow installs only its
  matrix engine, so a hard chromium dependency would have crashed the
  firefox/webkit jobs; no engine at all fails loud.
- **`pnpm bench` refuses non-instant and unknown presets.** `--presets` accepted
  any id, but `presetBootToPreviewLiveMs` promises an INSTANT boot (no npm
  install in the path) and the deep-link silently falls back to the default
  preset on a typo — a from-scratch preset (`real-vite`) or a misspelled id
  would have measured a lie under the requested name. The harness now fails the
  preset loud (recorded `unmeasured` + note) when the boot echoes `npm install`
  or the page warns about an unknown preset id; verified behaviorally
  (`--presets real-vite,no-such-preset` → both `unmeasured` with honest notes).
  The aggregation CORE also enforces completeness now: a preset sample/stage set
  shorter than `runs` degrades to `unmeasured` (contract in `aggregate.mjs`, not
  only harness discipline; RED-first unit).
- **`chromium-light` e2e serialized in CI to kill the dev-server contention flake.** On the shared CI runner, ≥2 light-lane specs cold-booting a Vite-WASI dev server (owner + dev-server child + Rolldown WASI pthread pool) concurrently starved the owner worker (0 `emitChunk`, ~15s owner-RPC timeout), so the terminal-readiness poll timed out on a random spec subset (also red on `main`). The light lane now runs `--workers=1` **in CI only** — reproduced locally at `--workers=16` (16 fail) vs `--workers=1` (all pass); the heavy lane already proved single-boot-at-a-time is reliable. Local runs keep parallel (beefy machines don't oversubscribe). Re-enabling light parallelism for speed would need the owner to survive concurrent boots. Closes the `light-lane-dev-server-boot-contention-flake` backlog item.
- **e2e lanes run as parallel matrix jobs, not sequential steps.** `e2e-chromium`
  is now a `matrix: lane: [heavy, light, prod]` (separate runners) instead of one
  job running the three lanes back-to-back. e2e wall-clock becomes `max(lane)`
  instead of the sum; separate runners also remove heavy↔light contention
  entirely (each lane gets a dedicated machine). `fail-fast: false` so one red
  lane doesn't cancel the others; report artifacts are per-lane
  (`playwright-report-<lane>`).
- **Scoped Playwright CI serialization to the heavy specs — light lane runs in
  parallel again.** Replaced the global `workers: CI ? 1` (which serialized the
  whole e2e suite) with two chromium lanes: `chromium-heavy` (TS-LS / fullstack
  cold-boot specs, run serially with `--workers=1`) and `chromium-light` (the
  remaining ~29 isolated specs, default parallel). CI runs them as separate
  steps so a heavy cold-boot never contends with the light lane — the contention
  that forced `workers=1` (heavy specs starved each other across files even with
  in-file `describe.serial`). Resolves backlog
  `process-meta/playwright-ci-worker-scope`.
- **Cache the Playwright browser binary in CI.** `ci.yml` + `ci-cross-browser.yml`
  cache `~/.cache/ms-playwright` keyed by the resolved Playwright version, so a
  version bump busts it but normal runs skip the uncached CDN download (only the
  apt system deps re-run on a hit). Also fixed the cross-browser chromium row
  (`test:e2e:` → the two-lane `test:e2e`).
- **Fail-fast `maxFailures` on CI e2e.** `playwright.config.ts` stops after 12
  failures, `playwright.prod.config.ts` after 2 — a broadly-broken run no longer
  burns every cold-boot cycle before going red.
- **Public npm registry pinned — no more corporate-mirror lockfile poisoning.** Root `.npmrc` now sets `registry=https://registry.npmjs.org/` so a contributor's mirror `~/.npmrc` (e.g. `registry=https://npm.yandex-team.ru`) can no longer leak `tarball:` URLs into `pnpm-lock.yaml`. Prevents the poison at the source — beats the user/default registry + `npm_config_registry`. A scoped (`@scope:registry=`) or `--registry=` override could still poison the lock, but then CI's `pnpm install --frozen-lockfile` fails on the mirror host and blocks the PR, so no extra lockfile guard is warranted.
- **`pnpm pr:check` — one parallel per-PR gate.** New `tools/checks/pr-check.mjs` runs lint, typecheck, build:libs, check:arch, parity/e2e coverage, backlog/refs checks, and unit + parity concurrently with a buffered pass/fail summary; exit ≠ 0 on any failure. `test:e2e` stays separate (its playwright workers + vite server starve the timing-sensitive parity checks when co-scheduled); CI keeps its own e2e job.
- **`pnpm check:arch` (dependency-cruiser) replaces `check:deps` (madge) and folds in `check:isolation`.** One ruleset (`tools/checks/arch-rules.cjs`) enforces layer top-down direction (previously UNENFORCED — madge caught only cycles, not reverse edges), no cycles, no foreign `src/internal/*`, and solid-js only in playground (D-002). Unlike madge it honors `@riftydev/*` subpath `exports`, so cross-package subpath edges are visible (madge silently skipped 29). `madge` dropped; `no-solid-outside-playground.mjs` removed. Resolves backlog `process-meta/directional-layer-boundary-check` + `process-meta/madge-subpath-exports-cycle-blindspot`.
- **Netlify playground deploys.** GitHub Actions deploys pushes to `main` to
  production and same-repo PRs to stable `pr-<number>` preview aliases, with
  the latest preview URL written back to the PR.

### Changed

- **Playground editor initial tabs are preset-owned ordinary files.** Removed the
  hardcoded special program tab: presets now declare the ordered file tabs opened
  at boot, `src/main.js` closes/reopens like any other file, and Files/GIT
  status follows editor writes through the same owner-backed path.
- **Backlog refine→ready model + `rifty-refine` skill.** Items/epics now carry `draft|ready` status (epics also `in-progress`); closure = delete-on-done (git history is the record). `ready` = a contract an implementer can't close with an approximation — `## Acceptance` / `## Parity cases` / `## Out of scope` (loud-throw) / `## Decisions`, enforced by `backlog:check`. New `docs/backlog/epics/` — a user-value umbrella over items, cross-area, with an end-to-end user scenario as its acceptance. Manual `rifty-refine` skill brings a piece of value to `ready` (deep analysis vs code/ADRs/Node, grill-on-scenarios until scope is sharp, ADR-before-ready for irreversible forks). Migration: 220 items `active|parked|blocked` → `draft`; 16 `shipped` deleted. Recorded in `AGENTS.md` + `docs/process/decision-workflow.md` (process change, not an ADR, per repo convention).
- **Production npm registry proxy emits CDN-ready cache headers (ADR-0176).**
  Yandex Caddy config now marks tarballs immutable for one year and packuments
  short-lived (`max-age=300`, `stale-while-revalidate=86400`) with `Vary:
  Accept`, keeping the proxy payload-transparent while enabling a CDN/cache in
  front of it. CDN/DNS rollout remains a confirm-first infra action.
- **Git PR #78 review follow-ups.** Tightened annotated-tag commit-ish peeling, revision/path ambiguity refusals, apply runtime conflict handling, stash identity preservation, merge-show/ls-remote behavior, selected success output, and the public git compat claims.
- **TS language service now requires project-owned TypeScript (ADR-0177).** The
  service no longer falls back to rifty's vendored compiler when
  `node_modules/typescript` is absent; missing or broken workspace TypeScript
  fails loudly. The playground surfaces init failures in Problems, and the
  TypeScript starter owns its `typescript` devDependency plus snapshot.
- **Kernel server-process model (`serve`) — ADR-0143 "D" phase P1 (ADR-0144).** The kernel gains a `serve` spawn flag so a long-lived owner-worker is NOT reaped when its entry settles cleanly (`finalizeWorkerEntry`); the real-vite preview owner drops its `await new Promise<never>(() => {})` keep-alive hack. First landed phase of the ADR-0143 owner-worker execution model (one worker owns `node_modules` + runs the shell/CLI/`execSync` in-realm, PAGE = viewer — retiring the bin-worker ENOENT class). Phased plan + status: `docs/backlog/shell/d-owner-worker-milestone.md`.
- **Kernel server-process model (`serve`) — ADR-0143 "D" phase P1 (ADR-0144).** The kernel gains a `serve` spawn flag so a long-lived owner-worker is NOT reaped when its entry settles cleanly (`finalizeWorkerEntry`); the real-vite preview owner drops its `await new Promise<never>(() => {})` keep-alive hack. First landed phase of the ADR-0143 owner-worker execution model (one worker owns `node_modules` + supervises shell/CLI/`execSync` execution, PAGE = viewer — retiring the bin-worker ENOENT class). Phased plan + status: `docs/backlog/shell/d-owner-worker-milestone.md`.

### Fixed

- **Node parity runner `exec-sync` mode preserves missing-child `ENOENT`.** The
  synchronous in-realm harness now checks the VFS mirror before loader-running a
  child, so `execSync('node missing.js')` surfaces `ENOENT` through the same
  binary-frame path as the runtime handler instead of being flattened to
  `ECHILDFAILED`.

### Documented

- **PR #76 review honesty fixes.** Diagnostics in the TS language-service compat
  matrix are downgraded to `⚠️` until diagnostic tags/related information are
  parity-covered, and the C1-C6 follow-up gaps are now explicit backlog items
  with code seams.
- **TS language service honest hard ceiling reached except explicit parked backlog (ADR-0166/0177).** The generated compat matrix `docs/public/compat/ts-language-service.md` now reflects the delivered browser-achievable `ts.LanguageService` surface: core diagnostics/navigation/editing plus refactors, decorations, call hierarchy, on-type formatting, workspace TypeScript, raw + encoded classifications, full `getNavigateToItems` parameters, `toLineColumnOffset`, lifecycle cache/dispose, emit, supported-code-fix inventory, and long-tail editor helpers. ✅/⚠️ rows are parity-checked against the real selected TypeScript compiler where they claim TS parity and exposed through engine/protocol/client; Monaco providers are wired where standalone Monaco exposes a provider shape. Parked, not fake-✅, backlog rows: interactive inlay label parts, encoded classification format variants, and custom UI for interactive/post-edit-rename refactors. True ceilings stay explicit ❌: `applyCodeActionCommand` package-install side effects, code lens, non-TS/JS native LSP, and non-cloneable compiler object graphs (`getProgram`, `getCompletionEntrySymbol`).

- **git over VFS (isomorphic-git) backlog sharpened to an honest tight-contract item.** `docs/backlog/shell/git-command-isomorphic.md` rewritten from a thin sketch into a hard contract: verified isomorphic-git ceiling (canonical-object SHA fidelity = parity anchor; smart-HTTP-only — SSH/`git://`/dumb-HTTP throw; GitHub/GitLab/Bitbucket CORS-blocked so clone/push need an env-config corsProxy + `onAuth`, never hardcoded; rifty egress is CORS-bound host `fetch`), explicit loud-throw boundary, pre-resolved decisions, acceptance gates that forbid partial merge, and a parity oracle via ADR-0093 frozen golden fixtures + deterministic commit-SHA equality (NOT a live `git` spawn). Placement: new `@riftydev/git` capability package (analogue of npm-client), IRREVERSIBLE → its own ADR, gated on M12.
- **Bin/shell + `execSync` worker-VFS transport decided → D (owner-worker), ADR-0143.** Resolves why an installed CLI (`cowsay`) ENOENTs from the shell: the spawned worker passes its own empty `MemoryFsSync`; the shell's `node_modules` live in PAGE memory (no shared OPFS). Fork B (SAB fs-proxy to PAGE) vs D (single owner-worker holds files + execution, PAGE = viewer) settled as **D** — milestone-scale, IRREVERSIBLE, gated on a kernel server-process model (ADR-0077 follow-up). Premises re-verified; ADR-0137's wrong root-cause sentence corrected in place; `node-entry-bootstrap.ts`'s stale "SAB-backed sync mirror" comment fixed. Verified finding folded in: the `execSync` entry-kind flip is NOT a safe standalone increment (it regresses the passing COI e2e `tests/e2e/execsync-sab.spec.ts`) — it lands WITH D. Pre-ADR analysis is folded into ADR-0143; the historical shell `.bin` backlog is closed.
- **Agent rules unified for Codex + Claude Code.** `AGENTS.md` is the single binding rules file; `CLAUDE.md` is now a symlink to it. Both cut to the binding minimum; vision/layers moved to `docs/ARCHITECTURE.md`, test pyramid + new minimal-mocks policy to `docs/process/testing.md`, full reversibility checklist + subagent budget grafted into `docs/process/decision-workflow.md`. New hard rule: every found bug/problem gets a regression test (failing before the fix) — no fix without its test.
- **M12 roadmap milestone + backlog: AI-first IDE for Node projects.** `docs/ROADMAP.md` gains M12 — an in-browser AI coding agent on the embeddable Pi harness (`@earendil-works/pi-agent-core`) over the M11 sandbox contract; only external dep is an OpenAI-compatible endpoint; AI lives outside rifty as a `@riftydev/*` consumer; reclaims the M12 slot from the dropped opencode-facade exploration (native-spawn tool layer = browser ceiling). New backlog: `distribution/ai-ide-pi-agent-harness` (+ `ai-agent-subagent-orchestration`, `ai-ide-product-ui`), `toolchain-build/ts-language-service`, `shell/git-command-isomorphic`. AI-agnostic capabilities (TS language service, git over VFS) land in rifty; the agent/prompts/bindings/UI stay in the consumer. Deduped against M11 (the AI-agent sandbox contract, IDE-kit EPIC C/D/E, shell grep/find, node/`.bin` commands already exist/tracked).

### Packaging

- **All 10 `@riftydev/*` libraries (+ `@riftydev/shadow-registry`) are now publishable to npm (ADR-0070).** Each package gains a `tsup` build (ESM + bundled `.d.ts` in `dist/`), a `publishConfig` pointing the published `main`/`module`/`types`/`exports` at `dist/` while the in-repo `exports` stay on raw `./src/*.ts` (dev/HMR loop unchanged), plus `version`/`license`/`repository`/`keywords`/`sideEffects`/`files`. `private` dropped. Source of truth: `tools/publishing/sync-publish-config.mjs` (`pnpm sync:publish`); release on a `v*` tag via `.github/workflows/release.yml`. `@riftydev/runtime-wasi` gains a `./worker-entry` subpath; `@riftydev/runtime-js` drops the unused `acorn-walk` dep. Verified by packing all 11 and importing them from a clean npm consumer. See `docs/PUBLISHING.md`.
- **Umbrella `@riftydev/sdk` package — one-install front door (ADR-0071, EPIC B).** A 12th publishable package (`@riftydev/sdk`): subpath re-exports of every layer (`@riftydev/sdk/vfs`, `@riftydev/sdk/io`, `@riftydev/sdk/kernel`, `@riftydev/sdk/runtime`, `@riftydev/sdk/wasi`, `@riftydev/sdk/net`, `@riftydev/sdk/npm-client`, `@riftydev/sdk/shell`, `@riftydev/sdk/terminal`, `@riftydev/sdk/service-worker`, kept external so singletons stay shared), a framework-free `createSandbox()` boot façade, and `checkCapabilities()`. The workspace root package is renamed `rifty` → `rifty-workspace` to free the name.
- **Releases are now tokenless via npm OIDC trusted publishing.** `release.yml` drops the `NPM_TOKEN` secret entirely and publishes with `id-token: write` + provenance; `packageManager` pinned to `pnpm@11.5.2` (11.0.x 404s on OIDC). First publish of each new name still needs a one-time token (npm can't attach trust to a package that doesn't exist yet); every release after is tokenless. See `docs/PUBLISHING.md`.
- **Local pnpm bootstrap tolerates stale registry mirrors.** CI still uses the
  exact `packageManager` pin, while local commands warn and continue with a
  compatible pnpm 11.x instead of trying to download `@pnpm/exe@11.5.2` from a
  user-level registry mirror that may not have synced it yet.

### Documented

- **ADR-0316 decides retirement of the ADR-0047 vendored esbuild WASI carrier.** The exact
  preview1 package remains an explicit conformance/showcase guest with pinned
  provenance; product esbuild has one registry-attested
  `esbuild-wasm@0.28.0` authority. The cutover must remove the checked-in blob,
  fetch script, bindings, transform export, and preview1 alias/overlay.
- **ADR-0311 decides removal of the public host-supplied esbuild WASM URL.**
  The builtin registry recipe owns acquisition and attestation; hosts continue
  resolving Worker, service-worker, and unrelated WASM deployment assets.
- **ADR-0316 retires the ADR-0047 vendored esbuild WASI carrier.** The exact
  preview1 package remains private conformance proof for `runWasi`; product
  esbuild now has one registry-attested `esbuild-wasm@0.28.0` authority, and
  the checked-in blob, fetch script, bindings, transform export, and preview1
  alias/overlay are removed.
- **ADR-0049 — WASI `cwd` option + `AT_FDCWD`/directory-open semantics (promotes Q-2026-05-27-003).** Running esbuild through `runWasi` forced the preopen/cwd API: `WasiOptions.cwd?: string` (Option A), `AT_FDCWD` resolution, directory-open in `path_open`, `fd_readdir` → `E_NOTDIR` on a file fd, and a wired stdin reader. Public-API change in `@riftydev/runtime-wasi`.

### Added

- **Git capability hard-ceil pass.** `@riftydev/git` and the shell `git` builtin
  now cover the achievable local-agent porcelain cluster on top of isomorphic-git:
  reset, parent revspecs, staged/HEAD/ref diffs, show, tag, remote/ls-remote,
  clean merge/cherry-pick/stash flows, and index-aware rm/mv. The git backlog
  item is closed; remaining absences are explicit compat ceilings in
  `docs/public/compat/git.md`.
  The 2026-06-23 adversarial pass regression-locks `diff HEAD <path>`, unborn
  `diff --cached`, `log -- <path>`, `reset --hard` worktree removals,
  `show <commit>` patch output, `stash@{n}`, loud `stash -u`,
  `ls-remote <remote>`, and `rm`/`mv` data-loss guards.
  The review fix-pass closes the remaining silent/partial edges: strict extra
  operands for remote/checkout/switch/merge/cherry-pick/network verbs,
  all-or-nothing `rm`, preflighted `mv`, diff pathspec parity, directed
  unsupported revspec ceilings, `log -n 0`/format ceilings, and blob-oid
  `show REV:path`.
  The usability phase adds repo-subdirectory pathspec translation,
  `diff --name-only|--name-status|--stat`, `ls-remote --tags/--heads`,
  clone `--no-tags`, fetch `src:dst` + tag/prune flags, and push single
  refspec/delete/`--tags` parsing; multi/wildcard refspecs stay loud ceilings.
  The clean patch/revert phase adds all-or-nothing `git revert <commit>` for the
  clean single-parent case and `git apply <patch-file>` / `git apply -` for clean
  text unified diffs over the VFS worktree. Conflict/sequencer/3-way/index/
  binary/rename/mode/mailbox forms are explicit `NotImplementedError` ceilings,
  never partial silent behavior.
- **git over the VFS (`@riftydev/git`, ADR-0167).** New tier-0 package + a shell `git` builtin + SDK `@riftydev/sdk/git`: git on isomorphic-git over the Memory VFS. Offline porcelain (init/add/status/commit/log/diff/branch/checkout) is byte-faithful to canonical git — a commit with fixed identity/dates yields the **identical 40-hex SHA-1** as real git (`commit-sha-parity.test.ts`); `status --porcelain` + `log --oneline` are byte-exact vs git 2.50.1 frozen golden fixtures. Network (clone/fetch/pull/push) routes over rifty's `node:http` egress with a D-004 env-config corsProxy (`RIFTY_GIT_CORS_PROXY`) + `onAuth`; a real `git http-backend` clone is integration-tested end-to-end (`network.integration.test.ts`). The browser ceiling throws loud, never stubs: ssh/`git://`/dumb-HTTP → `NotImplementedError('git.transport.*')`, cross-origin-without-proxy → `git.cors`, unimplemented git subcommands → exit 128. Compat: `docs/public/compat/git.md`.
- M0 Foundation: pnpm workspace, TypeScript strict, Biome, Vitest, Playwright (three engines), GitHub Actions.
- Playground app (Vite + SolidJS) with Monaco editor and xterm.js terminal, COOP/COEP cross-origin isolation, Run button.
- Service Worker skeleton, runtime-js worker entry stub.
- ADRs 0001–0008 (decisions D-001 through D-007).
- M1 JS Execution: Worker REPL, console capture, stdout/stderr streaming with colors, capabilities detection, traceback, `.reset`.
- M2 Modules: VFS interface + memory backend, unified resolver (CJS+ESM), CJS loader with cycle handling, ESM loader via `es-module-lexer` with live bindings and top-level await, dynamic `import()`, CJS↔ESM interop.
- M3–M9 (already shipped earlier; see TASKS.md for the verified acceptance).
- **M10 Real Tooling foundations:**
  - `fs.watch` and `fs.watchFile` (polling-based; tracked as ⚠️ in compat-matrix). 8 conformance tests covering rename/change events, EventEmitter interface, directory-watch filename reporting, `unwatchFile`, idle-no-fire.
  - `@riftydev/net` `WebSocket` + `WebSocketServer` + `WebSocketConnection`: in-process URL-routed duplex with `'open'` / `'message'` / `'close'` semantics matching the browser / Node `ws` API surface; `broadcast` for HMR. 5 conformance tests.
  - `@riftydev/shell` package: tokenizer (quotes, env-assignments, redirection), built-ins (`pwd`, `cd`, `echo`, `ls`, `cat`, `mkdir`, `rm`, `env`, `touch`), `>` / `>>` redirection, custom command registration, exit codes. 13 unit tests.
  - `@riftydev/service-worker` preview bridge: `installPreviewInterceptor` (SW side) + `setupPreviewBridge` (window side) for routing `/preview/<port>/*` fetches into the runtime's port registry over `MessageChannel`. 3 unit tests on the URL matcher.
  - `examples/vite-like-dev`: tiny Vite-equivalent dev server demonstrating the M10 vision end-to-end — serves HTML/JS from VFS over `@riftydev/net.http`, watches files via `fs.watch`, emits HMR over `WebSocketServer`, injects an HMR client into the served HTML. 3 integration tests.
  - Playground: `PreviewPanel` iframe component, `Dev Mode` toggle in `App.tsx`, editor↔VFS sync wired via `useRuntime.writeFile` and the dev-mode adapter.
  - `runtime-js/host`: `RuntimeController.writeFile(path, content)` for pushing editor edits into the in-Worker VFS.
  - `@riftydev/vfs` `OpfsFsSync` (ADR-0013) + `detectVfsBackend()`/`initBackend()` boot helpers: synchronous OPFS file ops via `FileSystemSyncAccessHandle` in a Worker realm; directory ops throw `NotImplementedError` (handled via paired `OpfsVfs`). Browser e2e persistence round-trip deferred to M11 follow-up.
- **M11 Vite-in-Worker (ADR-0043, supersedes ADR-0025 for the Real Vite path):**
  - `@riftydev/net`: new `cross-realm/preview-port.ts` module ships `previewPortChannelUrl(port)`, `serveCrossRealmPreview(port, dispatch)`, and `bridgeCrossRealmPreview(port, opts?)` over `BroadcastChannel` (same primitive as the HMR bridge). 6 unit tests cover GET round-trip, 4 KiB POST body preservation, worker-side throw → 502, and timeout → 502. Exported from the package index.
  - `apps/playground/src/glue/vfs-write-port.ts`: page→worker VFS write mailbox (`sendVfsWrite` / `serveVfsWrites`) so editor edits in the page realm hit the worker's local `syncMirror()`. 5 unit tests.
  - `apps/playground/src/workers/real-vite-bootstrap.ts`: new worker entry that boots Vite inside the kernel-spawned Real Vite worker. Installs `Buffer`/timer globals on the worker realm (no leakage onto the page's `Promise.prototype.then`), seeds the project, runs the npm-client install, overlays the esbuild/rollup-native shims, hosts the HMR `BridgedWebSocketServer`, opens the cross-realm preview + VFS-write bridges, starts `vite.createServer`.
  - `apps/playground/src/glue/realVite.ts`: rewritten to `globalProcessManager.spawnWorker(...)` the bootstrap, wire the page-side `bridgeCrossRealmPreview` into the `@riftydev/net` registry, pump worker stdout/stderr into the playground terminal, and forward `updateEntry(content)` over the VFS write port. Gated on `isSabIpcSupported()`; throws `NotImplementedError` otherwise.
  - ADRs: new ADR-0043. Cross-references: ADR-0025 status header points at ADR-0043 as the Real Vite superseder; ADR-0011 status header notes A-026 landed; ADR-0017 M12 scope expanded to include the new preview-port bridge in the BroadcastChannel→MessagePort swap.
- **M11 nested-install diamond regression test (ADR-0042, ADR-0021):**
  - `tests/integration/nested-install.test.ts` exercises first-wins-flat + nest-on-conflict end-to-end via real `.tgz` bytes (`debug@4.4.1`, `ms@2.1.3`, `ms@2.0.0`) plus one synthesized wrapper (`diamond-conflict-parent@1.0.0`, MIT, 613 B). Mirrors the live express conflict; asserts placement on disk, the duplicate `(name, version)` entries in the result set, and the npm-v3 lockfile keys carrying the install path. Pre-2026-05-27 this scenario was covered only by `express-live.opt-in.test.ts`, which CI skips by default.
  - `tests/integration/fixtures/registry/`: added `ms-2.0.0.tgz` (2.9 KB), `debug-4.4.1.tgz` (13.4 KB), `diamond-conflict-parent-1.0.0.tgz` (613 B) plus their per-version manifest JSON. `local-registry.ts` now picks the highest semver across vendored entries for `dist-tags.latest` instead of "last entry wins" so multi-version coexistence stays correct.
  - `tools/integration-fixtures/diamond-conflict-parent/`: source files for the synthesized wrapper (README documents the manual `npm pack` re-flow; the broader `refresh.ts` script for live-registry tarballs remains on the M11 backlog per ADR-0021).
