---
area: distribution
status: draft
title: no-COI toolchain tier defaults node:vm to the rewrite engine and fetches QuickJS WASM only when quickjs is selected
created: 2026-09-06
why: under ADR-0142's quickjs default every no-COI worker boot fetches the 503 KB QuickJS WASM although no step of the tier's scenario calls a vm sandbox API; the toolchain SDK surface has no engine selector, and worker-entry ignores a rewrite selection (ADR-0352 D5 gap), so a headerless host cannot avoid the download either way.
user_story: As a headerless host embedding the no-COI toolchain sandbox, I want boot to skip the QuickJS WASM download by default, but today every boot fetches emscripten-module.wasm (503 KB, 232 KB gz) although the tier never asked for it.
sources: [ADR-0142, ADR-0352, ADR-0375, docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md]
code: [packages/runtime-js/src/worker-entry.ts, packages/runtime-js/src/builtins/vm/quickjs-loader.ts, packages/runtime-js/src/builtins/vm/engine-config.ts, packages/runtime-js/src/ipc/install-process.ts, packages/runtime-js/src/host.ts, packages/rifty/src/sandbox.ts]
---

## Context

ADR-0142 makes QuickJS the `node:vm` default and names `rewrite` the loud
opt-in with "no WASM bundle, no membrane". Today's fetch is therefore
design-conformant; the bytes go away only with a policy flip (user decision
below). Separately, ADR-0352 D5 says rewrite-selected workers do not call the
QuickJS loader, and code honours that only on the COI kernel path
(`ipc/install-process.ts:125`); `worker-entry.ts:139` — the generic worker and
the no-COI toolchain worker via `import('@riftydev/runtime-js/worker')` —
awaits `ensureVmEngineReady()` unconditionally.

`RuntimeOptions.vmEngine` exists (`host.ts:33`) but is sent as `vm-config`
only in reply to `ready`, which posts after `boot` — after the preload
decision. `ToolchainCreateSandboxOptions` has no engine field and
`bootToolchainSandbox` spawns with `{ workerUrl }` only.

Sizing: 232 KB gz is ≈ 15% of today's no-COI boot bytes and ≈ 40% once
`runtime-js/lazy-typescript-tsconfig-discovery` lands (worker → 294 KB gz);
first boot only when the asset URL is bundler-hashed and HTTP-cached.
Toolchain restart (`sandbox.restart()`, PR #304 / I6) respawns the worker and
hits that cache.

## Challenge

challenge: 2026-09-06 — 5 problems
- Impact unsized against the whole: the doc states 503 KB / 232 KB gz only; its own evidence doc puts the no-COI boot payload at 1297 (worker) + 29 (sdk) + 18 (sw) + 232 KB gz, so QuickJS is ~15% of boot bytes and ~4% of a first-install session once `esbuild.wasm` (3761 KB gz) lands — a one-per-session fetch dwarfed by the ~18 s sandbox re-create goal.md records; no step of the tier's user scenario (goal.md steps 1-6: install → build → dev/HMR → reload → restart) calls a `vm` sandbox API, so the benefit is boot bytes only, and it becomes material (~40%) only after `runtime-js/lazy-typescript-tsconfig-discovery` lands (worker → 294 KB gz) — a sequencing the doc never states.
- Direction: this is the tier's first degradation that is not a browser ceiling — every existing `degraded` row (spawn, worker_threads, cpus) is forced by missing SAB, whereas rewrite-by-default voluntarily trades ADR-0142 §1 "correctness is the default" (silent eval-to-host leak, `instanceof` wrongly true, host globals visible in a "fresh" context — none throws) for bytes, against AGENTS.md "Simplicity never trades against Fidelity: cut machinery, not behavior"; it also forks `node:vm` semantics by tier (same program, different results COI vs no-COI), a per-tier compat-matrix column the repo has no precedent for. User override is recorded in `## Decisions`; surfacing, not blocking.
- The `why` misattributes the cost: ADR-0352 D5 covers *rewrite-selected* workers, and the no-COI worker is quickjs-selected by ADR-0142's default, so today's fetch is design-conformant, not a D5 contradiction; the real D5 gap (worker-entry.ts:139 ignores `__RIFTY_VM_ENGINE=rewrite`) is a separable one-line gate mirroring install-process.ts:125 needing no ADR — and it saves zero bytes under the default, so the byte saving rests entirely on the policy flip.
- "Every restart" and the RED target `restart()` cite an API that does not exist: toolchain `reset()` throws `NotImplementedError('sandbox.toolchain.restart')` (host.ts:490-494) and lands only with `no-coi-dev-hmr-restore` I6, unnamed as a dependency; the restart refetch is moreover served from HTTP cache for a bundler-hashed asset, as the doc's own "unless the browser cache intervenes" hedge concedes — the observed cost is first boot only.
- Opt-in mechanism gap: `vm-config` is sent only in reply to `ready` (host.ts:311), and `ready` posts after `boot` completes (worker-entry.ts:221), so the boot-time preload gate the draft proposes ("mirroring install-process.ts:125") cannot see `vmEngine: 'quickjs'` — the RED "`vmEngine: 'quickjs'` issues exactly 1 request" needs a pre-boot delivery channel (worker URL param / boot-awaited init) that neither exists nor is named or budgeted.

## Out of scope

- Generic (COI) worker default stays `quickjs` (ADR-0142 unchanged there).
- QuickJS JS glue (~52 KB min) stays statically bundled; ADR-0142's "no WASM
  bundle" claim is about the `.wasm`, not the glue.
- Rewrite-engine divergences listed in ADR-0142 §Consequences are accepted by
  the user for this tier; they surface in the capability report, not vanish.

## Decisions

- 2026-09-06 — user (rifty-refine, option B): no-COI toolchain tier defaults
  `node:vm` to `rewrite`; QuickJS WASM is never fetched unless `quickjs` is
  selected.
- override: 2026-09-06 — critic "direction": rewrite-by-default trades the
  ADR-0142 correctness default for bytes and forks vm semantics by tier —
  user chose B in refine with the ADR-0138 leak class named as the price.
- 2026-09-06 — user: overturns the ADR-0142 default for this tier only; a
  superseding ADR at pickup names the overturned decision (`DEC-2`) and adds
  the per-tier `node:vm` compat-matrix row.
- 2026-09-06 — agent: `vmEngine` on `ToolchainCreateSandboxOptions` is the
  explicit opt-in back to `quickjs` (public API → same ADR).
- 2026-09-06 — agent (after challenge): the engine must reach the worker
  before `boot` — carrier chosen at pickup between a worker URL query
  parameter and a boot-awaited init message; `vm-config`-after-`ready` cannot
  gate the preload. The D5 gate in `worker-entry.ts` (mirroring
  `install-process.ts:125`) rides along.
- 2026-09-06 — agent: the capability report (`schemaVersion: 1`) gains a
  `node:vm` row (`degraded`, rewrite engine, quickjs opt-in); wording lands
  with the ADR.
- 2026-09-06 — sequencing: material only after
  `runtime-js/lazy-typescript-tsconfig-discovery`; not `blocked_by` — the
  ADR and gate are independent.
- rejected route: default `quickjs` + `vmEngine` option (agent
  recommendation) — user: a headerless tier must not download 503 KB by
  default.
- rejected route: honour only `__RIFTY_VM_ENGINE` — non-public, depends on
  module evaluation order inside the sealed entry.
- RED targets: browser-unit request ledger (pattern:
  `tests/browser-unit/esbuild-vite-contract.spec.ts`) — no-COI boot issues 0
  requests for `emscripten-module.wasm`; `vmEngine: 'quickjs'` issues exactly
  1; `vm.runInNewContext` under the default passes the rewrite conformance
  subset.
