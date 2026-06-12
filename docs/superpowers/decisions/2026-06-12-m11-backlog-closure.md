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
