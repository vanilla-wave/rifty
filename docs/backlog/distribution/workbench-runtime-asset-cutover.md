---
area: distribution
status: ready
title: Workbench runtime-asset cutover — capability-only Vite runtime and sealed deployment
created: 2026-07-17
why: verified runtime assets are not a shipped capability while Vite can still read a host-supplied esbuild URL or one recursive Node entry can decode the obsolete bootstrap
user_story: As a Workbench Vite user, I want the Vite process to execute only the esbuild bytes proven by package acquisition, but today deployment configuration still supplies an unrelated host WASM asset.
epic: honest-shadow-substitutions
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/runtime-js/0267-entry-scoped-host-bootstrap-metadata-for-recursive-node-workers.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md]
code: [packages/workbench/package.json, packages/workbench/src, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry-url.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/ipc/recursive-runner.ts, apps/playground/package.json, apps/playground/src/adapters/playground-workbench-host.ts, apps/playground/src/browser-unit/workbench-vite-host-assets.ts, apps/playground/src/glue/playground-node-worker-runtime.ts, pnpm-lock.yaml, tests/browser-unit, tests/e2e, tests/e2e-prod, tests/integration/fixtures/workbench-vite-consumer]
---

## Context

The acquisition blocker establishes the attested package-tree epoch, ensures its
exact runtime-asset plan, reserves child admission, and gives every required
owner-supervised child a fresh `rifty.shadow-assets.v1` endpoint. This item
starts at that endpoint. It makes the verified reader the only esbuild byte
source used by Vite, removes every transitional host source in the same change,
and seals the Node-entry bootstrap after Workbench extraction.

The change is deliberately one cutover. Removing the host asset before the
reader works breaks Vite; retaining either URL/env/config fallback after it
works preserves two provenance owners. A compatibility decoder would preserve
the same ambiguity. Storage, planning, install timing, package-tree admission,
and performance measurement remain in their owning items.

The sealed implementation now lives in `packages/workbench`. The `code:` list names its owners;
Playground files are only host adapters and acceptance fixtures. No semantic
copy may remain under the app after the cutover. The listed
`playground-node-worker-runtime.ts` is a deletion/seal target: if extraction
retains that filename, it may only compose public Workbench worker URLs and may
not own raw Node runtime configuration.

## Acceptance

### Contract + RED

- First checkpoint adds failing exact v2 producer/decoder, host-seam rejection,
  capability-only Vite 7, empty-plan Vite 8, and teardown fault tests before
  changing production readers or deployment configuration.
- RED proves current Vite 7 can still consume host esbuild bytes, current Node
  entries still accept v1, and the built external Workbench journey cannot yet
  run capability-only. Greps are supporting evidence only.

### Final + GREEN

- Land reader adoption, host-seam/dependency deletion, and the v2 sibling sweep
  as one cutover. Every RED case plus the functional proofs below passes with
  no compatibility decoder, URL/env fallback, or app-local semantic copy.
- One committed SHA passes focused runtime-js/Workbench tests, built Chromium
  Vite 7/Vite 8 journeys, packed-consumer acceptance, and `pnpm pr:check`;
  Final+GREEN review has zero correctness blockers.

### Capability-only runtime consumption

- The acquisition reservation remains the sole parent-side admission seam.
  This item does not open the asset store, replan from a manifest, call ensure,
  or create a second child queue.
- A Node entry reads `readKernelEntryCapabilityPorts()` independently from its
  ADR-0267 bootstrap. For capability `rifty.shadow-assets.v1`, it constructs
  only the npm-client `ShadowAssetRuntimeReader` and passes that least-authority
  reader explicitly into Vite preparation before Vite or esbuild is imported.
  The child receives no installer, admin, receipt, storage path, manager, or
  peer-session handle.
- Explicit Vite `7.3.6` requires the capability. Missing, disposed, malformed,
  wrong-plan, deadline, or peer-closed access fails before Vite import through
  the typed port/read error path; absence loud-throws
  `NotImplementedError('vite.esbuild.shadowAssets')`. There is no retry from a
  deployment URL, environment variable, bundled byte array, or network fetch.
- The existing derived esbuild runtime receives the exact verified descriptor
  bytes from the reader and keeps its current upstream-derived filesystem and
  WASI behavior. It neither hashes a second source nor changes the descriptor.
  Manager/port verification remains the single byte-provenance owner.
- Default Vite `8.0.16` has the acquisition blocker's canonical empty plan. Its
  child carries no shadow capability, constructs no runtime reader, performs
  no manager read, and follows the ordinary Vite 8 runtime path.
- Kernel capability names, frames, plans, receipts, and bytes stay absent from
  guest `process.env`, argv, cwd, stdio, fork IPC, `KernelProcessSpec`, project
  snapshots, exports, and preview traffic.

### Atomic deployment seal

- Remove `deployment.wasm.esbuild` from the public Workbench option type,
  runtime validator, normalization, owner boot protocol, worker bootstrap,
  examples, packed-consumer fixture, and Playground host composition. The
  remaining `deployment.wasm.sqlite` stays unchanged.
- Remove the esbuild URL/value from `NodeWorkerRuntimeConfig`, every owner and
  child spawn builder, `playground-workbench-host`,
  `workbench-vite-host-assets`, and `playground-node-worker-runtime`. Delete
  `RIFTY_ESBUILD_WASM_URL` production reads/writes and the fallback branch they
  controlled. Delete `playground-node-worker-runtime` if extraction leaves no
  one-way public host-adapter responsibility for it.
- Remove the Workbench/Playground host dependency and bundler import that put
  `esbuild-wasm/esbuild.wasm` in deployment assets. Update package manifests and
  `pnpm-lock.yaml`; catalog source coordinates remain data and do not require a
  host dependency.
- Public and owner configuration decoders are strict. An input or owner frame
  containing the removed esbuild field rejects as invalid configuration or
  protocol input; it is never ignored. Packed types/examples contain no stale
  field. A clean packed consumer must not install or import esbuild WASM for
  host deployment.
- Remove the host seam only in the same commit series that makes the real
  capability-backed Vite 7 browser journey green. No intermediate merge SHA
  has zero usable source or two accepted sources.

### Node-entry protocol v2

- Atomically change `NODE_ENTRY_BOOTSTRAP_PROTOCOL` from
  `rifty.node-entry/v1` to `rifty.node-entry/v2`. The v2 host-runtime record has
  exactly kernel Worker URL, Node-entry Worker URL, and SQLite host values; it
  has no esbuild value or runtime-asset capability data.
- Update every finite producer and consumer in one sibling sweep: Workbench
  owner/bin/Node/dev-server paths, `execSync`, `worker_threads`, recursive
  runner, URL/config builders, decoders, pre-entry bootstrap, and all fixtures.
  Each recursive spawner uses the shared v2 builder rather than hand-building
  a record.
- A Node entry receiving v1, malformed v2, an extra esbuild field, or a v2
  record inconsistent with its entry kind rejects before pre-entry/import. No
  dual decoder, environment fallback, or v1-to-v2 coercion exists. Foreign
  non-Node protocols preserve
  `readNodeEntryBootstrapIfPresent() === null`.
- Capability ports remain a separate ADR-0266 entry field and do not move into
  v2. They are never inherited automatically. A recursive Vite child that
  requires esbuild but was not explicitly admitted with a fresh capability
  fails with `NotImplementedError('vite.esbuild.shadowAssets')`.

### Teardown and functional proof

- Consume the parent peer/session already registered by acquisition. The Node
  entry constructs its child client before Vite import; exit, kill, project
  close, Workbench close, manager close, protocol failure, and Vite preparation
  failure dispose the client/peer once without cancelling another manager
  waiter or peer. This item creates no second parent session or reservation.
- Preserve the acquisition-owned close order: fence child admission, close
  project runtimes/children/ports, quiesce its package FIFO, then flush the
  project; owner close then closes project authority, quiesces acquisition,
  closes manager/store, performs the final authority flush, exits the owner,
  and releases the Web Lock. Every stage is attempted and multiple failures
  aggregate in causal order.
- Built Chromium drives the generic public Workbench root with explicit Vite
  `7.3.6`. A real standard install yields a ready receipt through the blocker;
  dev server, production build, preview, dependency optimize, and HMR all use
  the capability reader and succeed with zero host-esbuild import and zero
  runtime-asset network request after admission.
- Close that durable Workbench, evict browser HTTP cache, take the source
  network offline, and reopen the same origin/project. Vite 7 readiness hits the
  verified OPFS chain and dev/build/preview still succeed; no reload-offline
  claim may rely on an HTTP-cache response or retained live manager.
- The same built-browser suite drives default Vite `8.0.16`: open/run/build/
  preview preserve current behavior with no ensure, asset progress, capability
  endpoint, reader construction, or esbuild runtime-asset request.
- Fault the capability read and close it during Vite preparation in the real
  Worker journey. Vite 7 fails visibly with the typed cause, publishes no false
  preview readiness, releases its route/child/session, and never falls back.
- Pack and install `@riftydev/workbench` into the clean external Vite host used
  by the controller blocker. Its compile, production build, and Chromium Vite
  7/Vite 8 journeys pass using only published root/worker subpaths. Source grep
  is supporting seal evidence, not functional acceptance.

## Parity cases

1. Vite 7.3.6 consumes byte-for-byte the descriptor member accepted by direct
   `ShadowAssetRuntimeReader` and the existing esbuild runtime parity suite;
   wrong member/hash/plan never reaches runtime initialization.
2. Default Vite 8.0.16 remains asset-free and preserves its existing CLI
   output, preview response, build result, and exit behavior.
3. A no-capability Node spawn preserves argv, cwd, env, stdio, IPC, exit, and
   Worker lifetime across the v1-to-v2 internal bootstrap change.
4. Capability name/frame/bytes remain unobservable through every Node-visible
   channel and through project snapshot/export.
5. Vite 7 capability failure has no behaviorally successful host/network
   fallback; the corresponding real-Node/external-Vite run is successful only
   when its normal local esbuild installation is present.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `provenance-lie` | Host esbuild field/import/env survives cutover | strict contract/seal test fails; no second byte owner ships |
| `provenance-lie` | Reader returns unknown/wrong-plan asset | typed failure before Vite import; no fallback or preview |
| `corrupt-input` | v1, malformed v2, or v2 with esbuild field | reject before pre-entry/import; no dual read |
| `observable-order` | Vite import starts before reader publication | impossible at pre-entry capability consumption seam |
| `torn-state` | Child reader construction/protocol start fails after entry | child, client, and acquisition-owned peer settle once; original failure survives |
| `torn-state` | Vite preparation fails after child starts | child, reader, port, route, and run settle; no false ready |
| `torn-state` | Project/owner close races an in-flight read | typed peer closure; complete causal teardown; no late preview |
| `sibling-drift` | One recursive producer or fixture remains on v1 | finite producer/decoder matrix fails atomically |
| `sibling-drift` | One Vite command still consumes host bytes | dev/build/preview/optimize/browser matrix fails |
| `false-fallback` | Capability missing or closes | loud typed/NotImplemented failure; zero URL/env/network fallback |
| `lossy-aggregate` | Cleanup and child failure happen together | original child/read failure first; cleanup failures aggregate after it |

## Out of scope

- Asset catalog/planning, install integration, attested-tree epochs, package
  FIFO admission, progress, and post-tree recovery; the acquisition blocker
  owns them.
- Storage layout, persistence, inspect/clear, receipts, manager/source
  algorithms, and MessagePort framing; consume their existing interfaces.
- Cold-fill timing, response-byte accounting, performance thresholds, or Eddy
  comparison; `distribution/workbench-runtime-asset-cold-bench` owns STD
  measurement and the Eddy item adds its matched row.
- Automatic descendant capability inheritance. An unadmitted recursive Vite 7
  consumer loud-throws `NotImplementedError('vite.esbuild.shadowAssets')`.
- Sass, external runtime adapters/registries, other binary-backed packages,
  alias retirement, selective CI, and npm publication.

## Decisions

- The verified reader is the only Vite 7 esbuild-byte interface; deployment
  configuration ceases to be a byte source.
- Reader adoption, host-seam deletion, dependency removal, and strict decoder
  rejection form one atomic cutover with no compatibility window.
- Node-entry v2 carries host runtime metadata only. ADR-0266 capability ports
  stay separate and explicitly supplied per admitted child.
- The acquisition module owns admission and readiness; this module owns runtime
  consumption and deployment sealing. Neither exposes the other's internals.
- Real built-browser Vite 7 and Vite 8 journeys close acceptance; greps,
  synthetic readers, and source-entry tests cannot substitute for them.
