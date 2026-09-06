---
area: distribution
status: draft
title: no-COI toolchain worker loads install and activation machinery on first install or restore, not at boot
created: 2026-09-06
why: npm-client (80 KB min), the shadow-substitution catalog and codec (24 KB) and the generated esbuild runtime adapter (73 KB) sit in the worker's boot graph but execute only inside install or restore.
user_story: As a headerless host that boots the no-COI toolchain sandbox for eval and file IO first, I want boot to download only the runtime, but today the worker ships ≈ 180 KB min of install machinery before the first install call.
sources: [ADR-0375, ADR-0352, docs/backlog/distribution/iframe-embed.md, docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/workbench/src/workers/workbench-runtime-adapters.ts, packages/workbench/src/workers/generated/esbuild-runtime.js, packages/npm-client/src/index.ts]
---

## Context

Written against the PR #304 tree (`edb8e1379`: `restoreActivation`,
`startBin`, `restart` exist there, not on main); lands after it.

Import chains (evidence doc): `no-coi-toolchain-worker.ts → @riftydev/npm-client
→ linker.ts → tools/shadow-registry codec + catalog json`, and
`workbench-runtime-adapters.ts → generated/esbuild-runtime.js`. `install`
and `RegistryClient` run only in `installManifest`;
`activateWorkbenchRuntimeAdapters` runs in `installManifest` and
`restoreActivation`. Boot is `import('@riftydev/runtime-js/worker')` plus the
message listener. After `lazy-typescript-tsconfig-discovery` the worker is
≈ 1 MB min / 294 KB gz; this machinery is ≈ 185 KB min / 53 KB gz of it.

Sizing against the whole (critic): an eval/fs-only host already has the
generic worker (`@riftydev/runtime-js/worker`, 702 KB min / 205 KB gz with the
compiler external — measured), smaller than the post-split toolchain worker;
for a host that installs, the split moves ≈ 53 KB gz from boot into a first
install that transfers ≥ 3.76 MB gz `esbuild.wasm` plus tarballs.

## Challenge

challenge: 2026-09-06 — 4 problems
- BLOCKING: cheaper direct authority for the named beneficiary — the Decisions line values "a host that never calls install/restore never downloads the chunk", but that host already has a public zero-work route: `createSandbox({requireCrossOriginIsolation:false, workerUrl})` on `@riftydev/runtime-js/worker` gives the same `runtime.eval` + `fs` RPC (`packages/rifty/src/sandbox.ts:41-48,230-260`, README names "headless eval-only use"), and measured with the same evidence-doc method it is 702 KB min / 205 KB gz (ts external) with zero `npm-client`/`shadow-registry`/`esbuild-runtime` inputs — smaller than the post-split toolchain worker (786 / 233); the split only helps a host that boots the toolchain worker and never installs, which is a host with no reason to pick that worker.
- impact unsized against the whole: for the host that does install later (the epic's only persona — goal.md scenario step 2 is `npm install`), the measured delta is 185 KB min / 53 KB gz shifted from boot into a first install that itself transfers ≥3.76 MB gz `esbuild.wasm` plus tarballs (evidence doc) — ~1.4% of the step it moves into; per boot it is ~10% of the real transfer (286 KB gz JS + 232 KB gz QuickJS wasm ≈ 518 KB gz, ≈40 ms at 10 Mbit/s), while the "18%" in Context is of worker JS min only, gz and the wasm are never mentioned, and the same-day sibling `no-coi-vm-engine-default-rewrite` removes 232 KB gz from every boot AND restart — a 4.4× larger lever on the identical cost.
- cited code and lane do not exist on this tree: `restoreActivation`, a `restore` request and `startBin` occur nowhere in packages/tests/tools except this draft (worker dispatches only `install`/`run-bin`; capability report and `tests/no-coi/no-coi-sandbox-build-loop.spec.ts` assert `toolchain.dev-hmr` throwing; `tests/no-coi/` has no HMR/restart lane), yet Context states the restore call site as present fact and the RED target requires an "install → Vite 7 build → HMR → restart" lane to stay green — the carrier is designed against `no-coi-dev-hmr-restore`, a draft child blocked by four prerequisites that will rewrite the same file.
- direction: the doc gates the no-install entry alternative on "re-open when a real embedder asks" but applies no such gate to the split serving the same unnamed host — the epic records adopter-share unsized with zero recorded pull, the mission lists production perf as a non-goal, and ROADMAP M11 "Embeddable" is controller/SDK surface, not bytes; a metafile RED, a new `import()` boundary and a chunk-fetch fault path are spent on a ~53 KB gz shift no user scenario in the repo asks for.

## Out of scope

- A host-facing option to disable install: a runtime flag removes no bytes
  from a static import graph.
- A separate no-install worker entry (build-time exclusion): sealed-entry
  bootstrap combinatorics (ADR-0352 correction), a capability-report change,
  and no named host — re-open when a real embedder asks, per
  `distribution/iframe-embed` ("refine when a real embedder pulls it").
- `@riftydev/kernel` in the worker (~60 KB min via `builtins/process.ts`):
  12 runtime-js import sites for ~15 KB gz — declined for now.

## Decisions

- 2026-09-06 — user (rifty-refine): lazy split without knobs — a host that
  never calls `install`/`restore` never downloads the chunk.
- OPEN (blocks draft→ready, README §Challenge): critic's cheaper direct
  authority — the eval/fs-only host is served by the generic worker, so the
  split has no named beneficiary. Verified: generic worker 702 / 205 KB.
  Resolution is the user's: override on the record, or delete this item
  (the rejected routes above stay recorded in the evidence doc).
- 2026-09-06 — agent carrier (if kept): one `import()` boundary reached on the
  first `install` or `restore` request; `runBin`/`startBin` after an
  activation use the already-loaded module; bytes cut only under a splitting
  bundler (documented host path).
- 2026-09-06 — fault (if kept): chunk fetch failure rejects that
  install/restore request with the fetch error; the worker stays live for
  eval and fs, never a silent no-op.
- RED targets (if kept): esbuild metafile over packed dist with `splitting:
  true` — the no-COI worker's eager chunk has no `npm-client`,
  `shadow-substitution-catalog.json` or `generated/esbuild-runtime.js` input;
  the no-COI Chromium lane of PR #304 stays green.
- Reversibility: REVERSIBLE — chunk boundary only.
