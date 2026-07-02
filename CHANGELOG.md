# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **`pnpm bench` refuses a partial or foreign-server measurement.** Two Fidelity
  hardenings on the install metric: (1) a pass now records `measured` ONLY when
  ALL `RUNS` samples reached first Vite response — a partial set (e.g. 1/5 after
  flakes) is `unmeasured` with the success count, never a launch-citable thin
  median; (2) the harness fails fast if the strict port is already serving
  (a stale/foreign dev server the run would measure instead of a fresh one) and
  refuses if its own spawned dev server exited before serving.

### Added

- **bench: instant-preset `pick→preview-live` metric with stage attribution.** `pnpm bench` gains a third phase (artifact schema v2): boots `--presets` instant presets (default `project-files,typescript-ls`) via the deep-link and records navigation→preview-LIVE median with per-run stages (`interactiveMs`, page-observable `viteReadyMs`); npm install is NOT in the path (baked snapshots). All runs must go live or the preset records `unmeasured` (no partial medians); `--presets none` records an explicit skip. CI smoke runs one JS preset and requires it to MEASURE (an `unmeasured` instant preset on a healthy prod stack means the boot broke — only ms stays ungated, PB-6). The committed `perf/benchmarks.json` is regenerated at schema v2 with the new metric (live registry+eddy pass).
- **Cold-start + npm-install benchmark harness (`pnpm bench`, `docs/backlog/perf/cold-start-and-install-benchmark`).** A zero-dep timing runner (`tools/perf/bench.mjs`) drives a headless Chromium tab (Playwright — already a devDep, not vitest `bench`) through the `?preset=real-vite&autorun=1` deep-link, median-of-N with a fresh browser context per run: (a) cold-start-to-interactive ms — always; (b) npm-install-to-first-Vite-response ms — only when `VITE_RIFTY_REGISTRY_URL` points at the deployed registry proxy (D-004), else recorded `requires proxy` (never silently skipped). Emits the committed `perf/benchmarks.json` a launch figure can cite (measured median, conservatively rounded up). A CI smoke gates on the harness PRODUCING a well-formed artifact — cold-start measured + the install number recorded — NOT on absolute ms (wall-clock is noisy on shared CI; PB-6). The pure aggregation core (median / conservative round-up / artifact schema) is RED-first unit-tested. When `VITE_RIFTY_RESOLVER_URL` is ALSO set, (b) runs TWO passes on the same port — a standard baseline (no resolver) then the eddy fast path — and nests the standard baseline + a measured `speedupX` under the eddy metric; a discarded warm-up run per install pass keeps the median steady-state (the first hit pays a one-off dev-server/proxy-connection cost a deployed warm server never re-pays). First real-browser measurement (live `registry.rifty.dev` + `eddy.rifty.dev`, `real-vite` preset, warm, median-of-5): standard **4284ms** → eddy **2517ms** = **1.70×** (committed to `perf/benchmarks.json`).
- **Eddy — opt-in fast npm install (epic `fast-install-resolver` + ADR-0182).** New `@riftydev/eddy` design: an opt-in server that runs rifty's OWN resolution (imports `@riftydev/npm-client` — one algorithm, no drift) and returns one artifact (a v3 lockfile + the bundled compressed tarballs); the client pre-seeds its tarball cache + writes the lockfile, then the EXISTING lockfile fast path installs in one round-trip, collapsing both the latency-bound packument and tarball waterfalls (~100 round-trips → 1 POST). The ~6x (~4s → ~0.6s) was a Node/sandbox model; the first REAL-browser measurement (harness above, warm h2) is **1.70x** (standard 4284ms → eddy 2517ms) — the metric shares the ~vite-boot and the standard baseline rides a warm-proxy h2 connection, not the 4s cold path. Getting there also fixed a client bug where the lockfile fast path did not replay shadow/user overrides, so eddy's pre-seeded lockfile threw `EBROKENLOCK` on every override package (`vite` → esbuild included) — see `@riftydev/npm-client`. Ready items `npm-client/eddy-resolver-service` + `npm-client/eddy-client-opt-in` (public `InstallOptions.resolverUrl`/`prefer`, SDK re-export, default-OFF, env-config, mirror-grade trust + non-disableable bytes integrity, auto-fallback to standard); draft `playground/eddy-from-scratch-presets`, `perf/eddy-http3-cold-validation`, `distribution/eddy-package-and-deploy` (npm + Docker, self-host). ADR-0182 records variant B (lockfile + compressed-tarball bundle; extracted-tree rejected), bounded staleness (TTL≤30min + `prefer-online` + as-of stamp = npm's own freshness model server-side), and supersedes `cold-npm-install-speedup`'s former `server-side-closure-resolver` + `bundled-popular-subgraph-metadata` draft items after measurement + adversarial verification.
- **Cold npm-install speedup backlog — 1 epic + 4 items.** `docs/backlog/epics/cold-npm-install-speedup`: the cheap, always-on, no-infra levers for the STANDARD install path. `npm-client/abbreviated-packuments` (corgi `Accept` header — cuts metadata BYTES ~2.5x; measured latency-bound so ~nil wall-time on a normal link, kept as a free bytes/parse win for slow/metered links), `perf/cold-install-metadata-reprofile`, `npm-client/persisted-packument-store`, `perf/install-transport-tuning` (HTTP/3 only — raising the fetch semaphore is browser-inert: one coalesced h2 connection per origin). The structural wall-time win moved to the `fast-install-resolver` (eddy) epic. Rejected levers (global OPFS CAS, ETag/304, brotli, worker-offload decompress, OPFS write consolidation, streaming SRI) recorded as out-of-scope. Sourced from a 2026-06-27 deep-research pass over `@riftydev/npm-client`.
- **Promotion / GTM backlog — 4 epics (3 ready, 1 draft) + 9 items (8 ready, 1 draft).** New `docs/backlog/epics/` for the developer-adoption push: `open-auditable-launch` (the discovery Show HN), `webcontainers-alternative-search-slot` (the verifiable compare page), `wasi-in-browser-showcase` (the one uncontested capability) — all `ready`; and `open-bolt-ai-sandbox-demo` (open client-side AI-sandbox reference) kept `draft`, since its live-preview path needs the IRREVERSIBLE `public-api-ai-agent-exec-preview` API (no ADR yet). Each maps to the product work it needs — launch deep-link, measured cold-start/npm-install benchmark, README wedge rewrite, publish `@riftydev/git`+`@riftydev/ts-language-service`, `rifty.dev/compare`, `examples/` AI-sandbox demo (draft), clickable WASI preset, standalone WASI example, `rifty.dev/blog` — and links the existing `toolchain-build/compat-matrix-test-result-sink`. Sourced from `docs/research/open-webcontainers-alternative-2026-06.md`.

### CI

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

- **ADR-0047 — revert to esbuild (`@esbuild/wasi-preview1`) as the M8/M10 WASI forcing consumer; supersedes ADR-0044 D1/D2.** ADR-0044's two premises were verified false at vendoring time: swc has NO WASI build (its published wasm is wasm-bindgen, not WASIp1), and esbuild DOES — `@esbuild/wasi-preview1@0.28.0` imports only `wasi_snapshot_preview1` (zero deps, ~20 MB), a different package from the gojs `esbuild-wasm` ADR-0044's audit inspected. ADR-0044 D3 (Go/gojs bridge deferred) stays valid and is now moot for esbuild. Q-2026-05-27-003's forcing consumer reverts to esbuild and the question is resolved (promoted to ADR-0049). PROJECT_PLAN.md, TASKS.md, OPEN_QUESTIONS.md, and `docs/compat/wasi.md` reverted to esbuild with cross-refs.
- **ADR-0049 — WASI `cwd` option + `AT_FDCWD`/directory-open semantics (promotes Q-2026-05-27-003).** Running esbuild through `runWasi` forced the preopen/cwd API: `WasiOptions.cwd?: string` (Option A), `AT_FDCWD` resolution, directory-open in `path_open`, `fd_readdir` → `E_NOTDIR` on a file fd, and a wired stdin reader. Public-API change in `@riftydev/runtime-wasi`.
- **ADR-0044 — esbuild ships gojs; substitute swc for M8/M10; defer Go-runtime bridge.** Planning correction: all published `esbuild-wasm` builds (0.21.5 / 0.25.0 / 0.28.0) import Go's `js/wasm` (`gojs`) ABI, not `wasi_snapshot_preview1`, so `@riftydev/runtime-wasi` cannot host them. swc takes esbuild's place as the M8 vendoring target and the M10 Vite shadow-binding target. Q-2026-05-27-003 (preopens/cwd API) keeps its A/B/C options but its forcing consumer is now swc; status stays Active. PROJECT_PLAN.md, TASKS.md, and OPEN_QUESTIONS.md updated; the Go-runtime bridge work is parked in TASKS.md Follow-ups. _(D1/D2 reversed by ADR-0047; D3/D4 stand.)_

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
