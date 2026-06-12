# M11 Backlog Closure Decisions

This file records decisions made while closing the M11 backlog on top of PR #21.
It is intentionally concise and append-only during the work.

## 2026-06-12

### D1 — Base PR

- **Decision:** Continue from PR #21 head
  `origin/codex/m11-backlog-closure-fresh-main` (`4ddfe4f`) on local branch
  `codex/m11-backlog-closure-pr21-finish`.
- **Why:** User requested PR #21 as the base; the head already contains the
  first M11 backlog slice.
- **Reversibility:** Reversible branch choice. No ADR.

### D2 — M11 Live Set Derivation

- **Decision:** Treat `rg -l "M11" docs/backlog` as the authoritative live set,
  then classify by each file's frontmatter (`active`, `parked`, `blocked`) and
  gate text.
- **Why:** `docs/ROADMAP.md` says M11 contributing work is tagged in backlog and
  intentionally not enumerated in ROADMAP.
- **Reversibility:** Process-local and reversible. No ADR.

### D3 — Closure Policy

- **Decision:** Active M11 items must be implemented, ratified, or verified.
  Parked/blocked residuals may be retargeted out of M11 only when their own
  text says the gate is future public API, new package, ADR reconsideration, or
  outward deployment.
- **Why:** Implementing every M11-tagged residual in one PR would violate the
  decision workflow by folding public API/deploy decisions into unrelated work.
- **Reversibility:** Reversible doc/process decision. No ADR unless a retarget
  changes public API behavior.

### D4 — Deployment Boundary

- **Decision:** The prod npm proxy item may add source/config/tests, but this
  session will not deploy or publish without explicit confirmation.
- **Why:** `AGENTS.md` confirm-first rule covers outward/destructive actions.
- **Reversibility:** Process rule application. No ADR.

### D5 — Storage Export Format

- **Decision:** Prefer a dependency-free JSON snapshot export/import for the
  M11 portability slice unless tests prove a tar/zip format is required now.
- **Why:** Adding a zip/tar dependency is irreversible; the existing snapshot
  shape can prove data leaves and re-enters the browser without new dependency
  commitment.
- **Reversibility:** Reversible if kept as playground-local format. New
  dependency or public archive contract would need ADR.

### D6 — Source Map Hook Boundary

- **Decision:** Do not widen `TransformSourceHook` from `Promise<string>` to a
  `{ code, map }` shape for M11. Use inline source maps or loader-internal map
  extraction instead.
- **Why:** ADR-0052 treats the hook request/return shape as load-bearing public
  API. Widening it would be an irreversible API decision.
- **Reversibility:** Reversible implementation detail if the public hook stays
  unchanged. Public hook changes need ADR.

### D7 — Node Test Scope

- **Decision:** Split the `runtime-js/vm-subset-node-test-support` closure into
  an immediately shippable `node:vm` subset and a separate `node:test` runner
  decision if the runner cannot stay minimal.
- **Why:** `node:vm` replaces an existing loud stub slot. `node:test` introduces
  scheduler, reporter, mock, and `TestContext` semantics and is materially
  larger than a stub replacement.
- **Reversibility:** `node:vm` subset is additive and reversible. `node:test`
  registration remains reversible if small, but a full runner contract may need
  ADR if exposed as a compatibility claim.

### D8 — Compat Closure Shape

- **Decision:** The M11 compat item closes by publishing concrete fs/streams/http
  public matrix pages from current tests and running the existing generator
  command. The script may remain a skeleton if the generated-data sink is filed
  separately as toolchain backlog.
- **Why:** The active M11 gap is the public claim surface at milestone close, not
  a full Vitest JSON reporter pipeline.
- **Reversibility:** Reversible docs/tooling work. No ADR unless a new dependency
  or CI gate is added.

### D9 — TS ESM Parity Oracle

- **Decision:** Promote `toolchain-build/ts-esm-parity-node-reference` to
  ADR-0132 and remove the provisional backlog markers.
- **Why:** The implementation already runs the Node side through vendored `tsx`;
  the remaining work was ratifying the oracle choice and fixing stale README
  wording.
- **Reversibility:** Tooling-only decision, but recorded as an ADR because it
  defines the parity oracle for future TypeScript cases.

### D10 — Prod Registry Proxy Boundary

- **Decision:** Close the active prod proxy source gap with a Netlify Function
  handler and route config, then file only the live deploy smoke as a blocked
  non-M11 residual.
- **Why:** Source and route tests are repo-local. Deploying the playground and
  proving a real URL are outward actions that require explicit confirmation.
- **Reversibility:** Repo-local source is reversible. ADR-0028 records the
  Netlify provider path inline; live evidence remains confirm-first and blocked.

### D11 — VM Subset vs Test Runner

- **Decision:** Close the runtime VM item with a tested `node:vm` subset and
  split `node:test` into a parked non-M11 backlog item.
- **Why:** `node:vm` replaces an existing loud stub and is parity-testable as a
  small slice. `node:test` is a separate runner contract with scheduling,
  reporter, mocking, and `TestContext` semantics.
- **Reversibility:** The VM subset is additive and documented with loud
  unsupported controls. The test runner remains uncommitted residual work.

### D12 — Storage Archive Format

- **Decision:** Close the storage portability item with a playground-local
  storage persistence probe and JSON workspace archive v1, then split deeper
  storage-pressure UX into a parked non-M11 residual.
- **Why:** The M11 user promise needs persistence request/quota visibility and
  a way for source files to leave/re-enter the origin. Zip/tar would add a new
  dependency and a stronger archive contract than needed for this slice.
- **Reversibility:** JSON archive v1 is app-local and dependency-free. Browser
  EDQUOT/eviction recovery and streaming/zip/tar archive formats remain future
  slices.

### D13 — Source-Map Remap Boundary

- **Decision:** Close the source-map item with loader-internal inline sourcemap
  extraction and scoped stack rendering for current-realm ESM guests, while
  keeping `TransformSourceHook` as `Promise<string>`.
- **Why:** Original `.ts` stack lines are the immediate DX gap and are parity
  testable. Widening the hook shape or designing cross-worker/overlay payloads
  would be a public contract decision outside this slice.
- **Reversibility:** Runtime-internal and dependency-free. Worker stack remap
  and visual overlay remain parked residual work.

### D14 — Compat Matrix Generation

- **Decision:** Close the milestone compat item by teaching
  `pnpm compat:generate` to publish deterministic fs/streams/http docs from
  static inventories backed by existing conformance and parity files.
- **Why:** The milestone obligation is a public claim surface now. A Vitest JSON
  reporter pipeline is broader tooling work and not required to make the M11
  fs/streams/http claims visible and repeatable.
- **Reversibility:** Tooling/docs-only. Future data-driven generation can
  replace the static inventories without changing runtime API.

### D15 — Host Resource Policy Retarget

- **Decision:** Retarget `kernel/host-operator-resource-enforcement` as future
  host-operator policy work, not current milestone closure.
- **Why:** Enforced Worker caps, watchdogs, memory signals, and fetch/egress
  policy change kernel public behavior and host configuration.
- **Reversibility:** Doc-only retarget. Implementation needs a new ADR.

### D16 — Server Worker Lifecycle Retarget

- **Decision:** Retarget `kernel/server-shaped-worker-process-lifecycle` as
  future kernel lifecycle work.
- **Why:** Native long-running worker support changes the public spawn contract,
  shutdown protocol, and exported worker-spawn types. The playground keep-alive
  workaround already preserves the current consumer surface.
- **Reversibility:** Doc-only retarget. Implementation needs its own ADR.

### D17 — Crypto Sync Expansion Retarget

- **Decision:** Retarget `runtime-js/crypto-sync-subset-expansion` as future
  verified-consumer crypto work.
- **Why:** Sync ciphers, KDFs, and signing need pure-JS correctness/timing
  decisions where SubtleCrypto cannot satisfy sync Node APIs.
- **Reversibility:** Doc-only retarget. Runtime additions stay gated on a real
  package need and focused tests.

### D18 — Platform/Arch ADR Reconsideration Retarget

- **Decision:** Retarget `runtime-js/platform-arch-adoption-friction` as a
  blocked ADR-0026 reconsideration item.
- **Why:** Changing `process.platform` / `process.arch` would contradict an
  active ADR and needs a decision subagent plus superseding ADR, not milestone
  cleanup.
- **Reversibility:** Doc-only retarget. Behavior remains unchanged.

### D19 — FileHandle API Retarget

- **Decision:** Retarget `runtime-js/fs-promises-filehandle` as future
  `fs.promises.open()` / FileHandle work.
- **Why:** FileHandle introduces async object lifetime, close-after-use errors,
  and lower VFS fd semantics beyond the high-frequency fd wall already covered.
- **Reversibility:** Doc-only retarget. Runtime API addition remains gated on
  package evidence and parity tests.

### D20 — runWasi Kernel Dispatch Retarget

- **Decision:** Retarget `runtime-wasi/runwasi-kernel-dispatch-wiring` as future
  runtime-wasi/kernel worker dispatch work.
- **Why:** The item first requires confirming whether heavy WASI guests route
  through `spawnWorker`; wiring stdin and worker dispatch can alter kernel
  process behavior even if ADR-0038 already authorizes the bridge.
- **Reversibility:** Doc-only retarget. Implementation stays gated on focused
  worker-dispatch tests and ADR-0038 compatibility.

### D21 — Starter Template Retarget

- **Decision:** Retarget `distribution/create-rifty-template` as future
  consumption-side scaffold work, and remove the distribution README's broad
  milestone framing.
- **Why:** Host headers, worker URLs, service-worker build, WASM asset copying,
  and editor bundling are consumer scaffold choices after the SDK surface is
  worth packaging into a template.
- **Reversibility:** Doc-only retarget. A template can start later without
  changing existing `@riftydev/*` package APIs.

### D22 — Dependency License Audit Retarget

- **Decision:** Retarget `distribution/dependency-license-audit` as future
  release/compliance audit work.
- **Why:** First-party MIT and self-hosting positioning is already documented;
  transitive dependency license inventory needs a generated report or release
  gate decision beyond the current page claim.
- **Reversibility:** Doc-only retarget. Future enforcement can be added as a
  checklist, report, or CI warning.

### D23 — Sandbox Exec/Preview API Retarget

- **Decision:** Retarget `distribution/public-api-ai-agent-exec-preview` as a
  future public SDK API design item.
- **Why:** Streamed command exec, cancellation/stdin/cwd/env semantics, and
  preview URL normalization expand `Sandbox` beyond ADR-0131's FS slice.
- **Reversibility:** Doc-only retarget. Implementation needs its own ADR and
  public API tests.

### D24 — Sandbox Snapshot/Restore API Retarget

- **Decision:** Retarget
  `distribution/public-api-ai-agent-contract-snapshot-restore` as a future
  public SDK API design item.
- **Why:** Snapshot, restore, and fork semantics require deciding disk-state vs
  process-state scope, archive format, quota posture, and Worker/VFS copy model.
- **Reversibility:** Doc-only retarget. Implementation needs its own ADR and
  public API tests.

### D25 — Workbench Controllers Retarget

- **Decision:** Retarget `distribution/workbench-controllers` as future EPIC C
  headless controller package work.
- **Why:** Lifting playground glue into `@riftydev/workbench` creates a new
  cross-package public surface and should wait for a concrete non-Solid consumer
  or a deliberate playground-thin-shell refactor.
- **Reversibility:** Doc-only retarget. Starting the package needs an ADR that
  promotes DD-3.

### D26 — Lower-Layer FsSync fd Retarget

- **Decision:** Retarget `vfs/fs-sync-fd-api-and-fsync-durability` as future
  lower-layer VFS fd and durability contract work.
- **Why:** The runtime-local fd tables cover practical build-tool behavior, but
  inode-like open-unlink/rename semantics and honest sync durability would
  change public `FsSync` guarantees.
- **Reversibility:** Doc-only retarget. Implementation needs a dedicated ADR and
  conformance evidence.

### D27 — Readable.fromWeb Pipe Sink Retarget

- **Decision:** Retarget `net/readable-fromweb-pipe-sink` as future
  `@riftydev/io` stream/web interop work.
- **Why:** The concrete Effect path still needs a verified web-stream/FormData
  consumer before adding `Readable.fromWeb`, broader toWeb/fromWeb conversions,
  or `node:stream/web`.
- **Reversibility:** Doc-only retarget. Additive stream helpers stay gated on a
  real consumer and compat-matrix claims.

### D28 — VM Context Assignment Review Fix

- **Decision:** Keep the `node:vm` subset but widen its context-source rewrite
  from top-level statements to a scoped AST walk.
- **Why:** Review found block/loop assignments to missing globals leaked to host
  `globalThis`; Node stores those writes on the sandbox object.
- **Reversibility:** Runtime-internal fix. Guarded by conformance and parity.

### D29 — Registry Prepare Metadata

- **Decision:** Ignore `prepare` scripts on registry package manifests while
  continuing to reject `preinstall`/`install`/`postinstall`.
- **Why:** Registry tarballs are already prepared; live Vite installs now see
  Rollup metadata with `prepare`, and blocking it prevents the e2e preview
  server from booting.
- **Reversibility:** npm-client behavior fix. Guarded by unit regression and
  live Vite install probe.

### D30 — Vite Shim Lifecycle Registry Adapter

- **Decision:** Strip `esbuild.postinstall` only in the playground's Real Vite
  registry adapter, keyed by `@riftydev/shadow-registry`
  `browserShimLifecycleScriptSkips`.
- **Why:** `esbuild.postinstall` selects native binaries, but the playground
  immediately overlays `esbuild` with the browser-safe shim. The default
  `npm-client` policy must still reject generic `postinstall` loudly.
- **Reversibility:** Playground-local adapter. Guarded by playground unit test,
  shadow-registry table test, live Vite install probe, and Chromium e2e.
