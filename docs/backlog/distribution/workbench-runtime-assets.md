---
area: distribution
status: ready
title: Workbench runtime assets — private owner cache, honest acquisition timing, child capability
created: 2026-07-15
why: manager bytes become a user capability only when the current Workbench owner composes private storage, joins every tree-ready outcome, exposes recovery, and removes esbuild from host deployment assets
user_story: As a Workbench Vite user, I want install to make exact esbuild bytes visibly ready, reusable offline, and recoverable without hiding cold install or exposing owner protocols
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-manager, npm-client/shadow-asset-message-port, kernel/worker-capability-ports, distribution/workbench-controllers]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/runtime-js/0267-entry-scoped-host-bootstrap-metadata-for-recursive-node-workers.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/adr/npm-client/0283-canonical-package-manifest-serialization.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/backlog/distribution/workbench-controllers.md]
code: [apps/playground/package.json, pnpm-lock.yaml, apps/playground/src/workbench/public.ts, apps/playground/src/workbench/errors.ts, apps/playground/src/workbench/open-workbench.ts, apps/playground/src/workbench/owner-protocol.ts, apps/playground/src/workbench/workbench-browser-owner.ts, apps/playground/src/workbench/workbench-owner-port.ts, apps/playground/src/workbench/project-materialization.ts, apps/playground/src/workbench/playground.ts, apps/playground/src/workbench/vite-project-runtime.ts, apps/playground/src/workbench/node-project-runtime.ts, apps/playground/src/workbench/internal/playground-workbench.ts, apps/playground/src/workbench/internal/browser-workbench-composition.ts, apps/playground/src/workbench/internal/playground-terminal-state.ts, apps/playground/src/workers/workbench-owner-controller.ts, apps/playground/src/workers/workbench-owner-bootstrap.ts, apps/playground/src/workers/workbench-owner-storage.ts, apps/playground/src/workers/owner-storage.ts, apps/playground/src/workers/owner-vfs-authority.ts, apps/playground/src/workers/workbench-project-store.ts, apps/playground/src/workers/workbench-project-vfs.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/workers/workbench-project-composition.ts, apps/playground/src/workers/playground-project-authority.ts, apps/playground/src/workers/owner-package-state.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/package-install-finalizer.ts, apps/playground/src/glue/project-deps.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/glue/package-mutation-executor.test.ts, apps/playground/src/glue/install-stamp.ts, apps/playground/src/glue/install-stamp-authority.ts, apps/playground/src/glue/storage-status.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/node-worker-runtime-config.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/vite-esbuild-runtime.ts, apps/playground/src/adapters/playground-workbench-host.ts, apps/playground/src/browser-unit/workbench-vite-host-assets.ts, apps/playground/src/glue/playground-node-worker-runtime.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry-url.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/ipc/recursive-runner.ts, tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, tools/perf/src/aggregate.test.ts, perf/benchmarks.json]
---

## Context

This is the only item allowed to join Workbench/Playground/runtime wiring.
Current `main` keeps Workbench app-local under
`apps/playground/src/workbench`; `distribution/workbench-controllers` remains
the extraction blocker. Its transitional `deployment.wasm.esbuild` stays
unchanged until this final join. After extraction, update only mechanical
`code:` paths; the named seams and contracts below stay fixed.

The current architecture already has one Workbench operation state machine,
exact owner protocol, browser pending-op map, owner controller/bootstrap,
`OwnerVfsAuthority`, package FIFO, and ADR-0278 deferred cold install. This item
extends those owners; it creates no parallel controller, VFS, or acquisition
path.

After the controller blocker lands, this final join owns ADR-0278's consume-once
correction at its then-current mechanical paths. Current app-local Vite/Node
runtimes close over `kind: install` and prepend `npm install` on every run. Move
that decision into captured owner terminal state: failure leaves it retryable;
the first successful materialization consumes it; later runs execute only the
requested runtime command. Do not edit the active extraction branch in parallel.

## Public interface

~~~ts
type RuntimeAssetStorageClass =
  | 'opfs-persisted'
  | 'opfs-best-effort'
  | 'memory-session'

type RuntimeAssetFailurePhase =
  | 'cache-check'
  | 'fetch'
  | 'verify'
  | 'persist'
  | 'ready'
  | 'inspect'
  | 'clear'
  | 'close'

interface RuntimeAssetFailure {
  readonly phase: RuntimeAssetFailurePhase
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly requiredSetDigest?: string
  readonly assetId?: string
  readonly usedBytes?: number
  readonly requiredBytes?: number
}

class RuntimeAssetError extends Error {
  readonly code: 'ESHADOWASSET'
  readonly phase: RuntimeAssetFailurePhase
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly requiredSetDigest?: string
  readonly assetId?: string
  readonly usedBytes?: number
  readonly requiredBytes?: number
  constructor(failure: RuntimeAssetFailure)
}

type RuntimeAssetProgress =
  | Readonly<{
      phase: 'cache-check' | 'fetch' | 'verify' | 'persist'
      assetId: string
      assetIndex: number
      assetCount: number
    }>
  | Readonly<{
      phase: 'ready'
      requiredSetDigest: string
      assetCount: number
      storageClass: RuntimeAssetStorageClass
    }>

interface RuntimeAssetCacheInspection {
  readonly storageClass: RuntimeAssetStorageClass
  readonly entryCount: number
  readonly storedBytes: number
  readonly verifiedObjectCount: number
  readonly verifiedObjectBytes: number
  readonly readySetCount: number
}

interface WorkbenchRuntimeAssets {
  inspect(): Promise<RuntimeAssetCacheInspection>
  clear(): Promise<RuntimeAssetCacheInspection>
}

interface WorkbenchProjectOpenOptions {
  readonly onRuntimeAssetProgress?: (
    progress: RuntimeAssetProgress,
  ) => void
}

interface PlaygroundProjectOpenOptions
  extends WorkbenchProjectOpenOptions {
  readonly initialTerminalState?: ProjectTerminalSnapshot
}

interface Workbench {
  readonly runtimeAssets: WorkbenchRuntimeAssets
  openProject<T>(
    definition: ProjectDefinition<T>,
    options?: WorkbenchProjectOpenOptions,
  ): Promise<ProjectSession<T>>
}
~~~

`RuntimeAssetError` is exported through `workbench/public.ts`; its constructor
sets `name='RuntimeAssetError'` and derives `message` only from `phase` using
this package-private fixed table:

~~~text
cache-check -> Runtime asset cache check failed
fetch       -> Runtime asset fetch failed
verify      -> Runtime asset verification failed
persist     -> Runtime asset persistence failed
ready       -> Runtime asset readiness failed
inspect     -> Runtime asset inspection failed
clear       -> Runtime asset cache clear failed
close       -> Runtime asset manager close failed
~~~

`RuntimeAssetFailure` therefore accepts no message. Owner errors from
ensure/install/inspect/clear are sanitized to exactly
`{name:'RuntimeAssetError',code:'ESHADOWASSET',message,phase,recovery,
requiredSetDigest?,assetId?,usedBytes?,requiredBytes?}`. Browser strict-decodes
that discriminant, requires the fixed message for its phase, and reconstructs
the public prototype. The owner never copies an internal `error.message` into
this branch. Cause, stack, transport details, URLs, internal tree result, exact
plan/receipt, paths, and owner ids never cross. Other Workbench failures retain
their current `{name,message}` wire.

`PlaygroundWorkbench.openProject` accepts the extending companion type and both
`internal/playground-workbench` and `browser-workbench-composition` forward it
without narrowing. Root generic open and companion trusted/snapshot open
correlate progress to the private owner operation id before a session exists.
A callback throw is caught, logged once with that operation id, and never
changes owner acquisition or response handling.

`workbench-owner-controller` creates an owner-local progress sink capturing the
current open `opId` and passes it explicitly through
`ProjectMaterializer.open → ProjectAcquisitionPort.ensure` or
`PlaygroundProjectAuthority.openProject`. The sink alone emits the correlated
progress frame and is dropped at terminal response. No page callback crosses
IPC and no global/current-operation slot retains it. Cold companion terminal
installs instead use their captured PTY writer.

`assetIndex` is zero-based canonical-plan order; `assetCount` is constant.
Phases for one asset preserve order and may omit `fetch`/`persist` on a verified
hit. `ready` emits once after pointer/storage acknowledgement. Empty plans emit
nothing.

Inspection counts all semantic store entries and decoded entry bytes, including
temp/corrupt/orphan state. Verified object and ready-set counts include only a
valid hash/receipt/pointer chain. Tarball cache and project trees are excluded.
All counts are non-negative safe integers. Successful `clear()` returns the
acknowledged all-zero inspection with unchanged storage class.

## Owner protocol and state

- Add `clearing {ownerPromise}` to the existing `ProjectOperation` union in
  `open-workbench.ts`. `clear()` validates/claims idle before its first await;
  opening, active, deleting, another clear, closing, or closed observes the
  existing busy/closed errors. A failed clear restores idle. A failed open also
  restores idle so admin recovery remains available.
- Route both generic and companion deletion through one package-private
  `deleteProjectWithOwner` root operation, symmetric with
  `openProjectWithOwner`. It claims `deleting` synchronously before the catalog
  owner call. The companion must not call the catalog directly, so
  `runtimeAssets.clear()` sees every delete through the same root state.
- `inspect()` is read-only in idle/opening/active/deleting/clearing and rejects
  `ClosedHandleError` once close starts. It linearizes in owner order; if a
  claimed clear is ahead, inspection returns post-clear state.
- Extend the strict exact-key wire and browser pending map with:

  ~~~text
  page -> owner  workbench:runtime-assets-inspect {opId}
  page -> owner  workbench:runtime-assets-clear {opId}
  owner -> page  workbench:runtime-assets-progress {opId, progress}
  owner -> page  workbench:runtime-assets-inspected {opId, inspection}
  owner -> page  workbench:runtime-assets-cleared {opId, inspection}
  ~~~

  Existing `workbench:failure {opId,error}` is the only terminal failure.
  Progress is valid only for the matching pending generic/playground open; a
  duplicate/unknown/late id or progress after a terminal frame is protocol
  failure. Root and companion opens use their existing distinct request frames
  but the same progress validator and observer isolation.

## Acceptance

### Composition and private storage

- `installWorkbenchOwnerStorage` selects/installs the backend. Move/reuse the
  existing `probeStoragePersistence` inside owner boot; page boot sends only
  clone-safe policy. Probe absence/failure yields best-effort, never a false
  persisted claim.
- Construct exactly one `OwnerVfsAuthorityComposition(syncMirror())`. Before
  creating `workbench-project-store` or any project-rooted view, build a
  path-neutral `ShadowAssetStorage` over its private `authority` rooted at
  `/.rifty/workbench/v1/runtime-assets/v1/{objects,receipts,ready,tmp}`.
  Do not capture or expose the raw installed backend.
- The private asset adapter resolves a mutation only after the authority reports
  no persist failure for semantic asset-root paths. Project materialization and
  `awaitDurability()` likewise inspect only project/materialization paths. The
  authority's final owner flush still aggregates every path, but an asset-only
  quota/path fault cannot poison project durability and a project-only persist
  fault cannot acknowledge an asset publication.
- Construct one manager, then package authority, then owner controller/ready.
  The same composition is used by generic and companion boot. Manager,
  adapters, registry client, callbacks, errors, and signals never cross boot
  IPC.
- Guest/owner-child/project VFS absolute/traversal reads, recursive rm,
  snapshots, archive/export, SCM, project reset, and `deleteProject` cannot
  observe or mutate the asset root. Sequential projects reuse it under the
  existing `rifty:workbench:v1` Web Lock.
- `runtimeAssets.inspect()`, not `OwnerStorageSnapshot`, exposes
  `opfs-persisted|opfs-best-effort|memory-session`. Only confirmed
  `persistedAfter` plus durable OPFS yields `opfs-persisted`. OPFS data survives
  Workbench close while origin data exists; memory is owner-session only.
- Idle clear fences owner admission, waits manager flights, clears semantic
  storage, awaits acknowledgement, and returns inspection. It does not clear
  npm tarballs or projects. `deleteProject` retains assets.

### One acquisition join, two honest UX timings

- Add one named FIFO `post-tree runtime-asset readiness` seam to
  `PackageAcquisitionAuthority`. Every trusted-existing, verified-snapshot, and
  installed-tree result passes it, including the early `#trustedProvenance`
  return. Input is exact plan plus optional already-ready install receipt;
  manager ensure is skipped only for that matching receipt.
- Each install call passes one scoped `InstallOptions.shadowAssets` group.
  Generic open maps manager phases to its correlated open observer; companion
  first materialization and later terminal installs map them to only that
  terminal. Project/terminal close supplies the same operation's abort signal;
  RegistryClient no-progress bounds remain the cold-fetch bound. No callback or
  signal survives settlement or crosses owner IPC.
- `OwnerPackageState` retains one owner-private monotonic tree epoch as
  `{project:{root,slug}, sequence,
  readiness:unavailable|not-required|pending(plan)|ready(plan,receipt)}`. It never enters
  `ProjectAcquisitionPlan` or page/companion wire. The canonical active
  `{root,slug}` must match at every read; project switch installs an unavailable
  epoch for the new project before a deferred-cold session can return. Pure
  pre-mutation validation failure/no-op keeps the prior epoch. One idempotent,
  acquisition-token-bound
  `beginTreeMutation(project)` marks it unavailable while the FIFO excludes
  child admission. Invoke it immediately before every owner mutation boundary:
  `prepareEnsure` clear/seed, snapshot `prepared.apply()`, terminal
  `prepareInstall`, reset/switch clear, existing tree-demotion ingress, and from
  npm-client's exact once-before-link `onTreeMutationStart`. Duplicate calls for
  the same token are no-op; project/token mismatch rejects before mutation.
  Successful empty-plan install publishes `not-required`; non-empty install
  publishes its returned plan/receipt atomically. Typed post-tree
  `ESHADOWASSET` plus successful finalization publishes the error's exact plan
  as pending; other failures never expose the stale epoch. Trusted/snapshot
  planning publishes pending before their external ensure.
  `package-mutation-executor.ts` advances its shared impact union to
  `none|package-only|tree`: exact `package.json` and exact `package-lock.json`
  are `package-only`, while `node_modules`, an ancestor replacement/removal, or
  any combined mutation that can touch the installed tree is `tree`.
  `package-only` demotes v4 trust but keeps the currently installed tree epoch;
  `tree` invokes `beginTreeMutation` before the shared mutation executor's first
  write as well as performing its stamp transition. A later tree-ready outcome
  replaces the retained epoch.
- Fresh install supplies the planner output/receipt from its exact applied
  substitution trace. Trusted-existing and snapshot paths re-read the stored
  lockfile and run the same npm-client lockfile-facts planner. Stamp package
  count, installed-name coincidence, app catalogs, and terminal text never
  reconstruct a plan.
- Generic root `activateAndEnsure` retains current behavior: real install/reuse
  occurs during `openProject`, readiness precedes `workbench:project-opened`,
  and owner progress goes to `onRuntimeAssetProgress`.
- Companion trusted-existing and valid-snapshot outcomes also ensure before
  `workbench:playground-project-opened`. Companion
  `firstMaterialization: install` and rejected-snapshot fallback retain
  ADR-0278: open returns session/default terminal without installing. First
  `session.run()` writes `$ npm install`, performs tree install then asset ensure,
  renders manager phases in that terminal, and only then spawns Vite/Node. The
  open callback is not retained or invoked for this later cold work.
- Every later terminal install uses the same FIFO and terminal progress. It
  exits zero only after its new required set is ready. A manifest edit is FIFO,
  demotes v4, and does not invent a new tree; the next tree-ready install/reuse
  recomputes and ensures its plan.
- Advance install claims to v4 in `install-stamp.ts` and
  `install-stamp-authority.ts`: keep v3 fields; add `lockfileSha256` as 64
  lowercase hex digits over exact stored `package-lock.json` bytes. Promotion
  and trust re-read exact manifest/lockfile. v1-v3, missing, edited, or
  mismatched lockfile is a miss. Use npm-client `serializePackageJson` for
  manifest writes; do not copy its canonicalizer.
- `InstallStampAuthority.checkSync()` cannot prove v4's lockfile SHA with
  browser WebCrypto. For an on-disk v4 it conservatively returns `absent` to
  `primePrefetch` without changing the authority's in-memory phase; ordinary
  async `check()` re-reads and hashes exact bytes before reuse. Do not export or
  copy a synchronous SHA implementation. Accept the possible redundant bounded
  Eddy prefetch on warm boot; later async trust may leave its result unused.
- Recognize only typed post-tree `ESHADOWASSET` before
  `npm-shell-command.ts` package-add rollback. Preserve the exact post-install
  manifest/lockfile and run `finalizePackageInstallFiles`. On finalizer success,
  return internal
  `post-tree-failure {treeResult,packageJsonText,lockfileSha256,error}` so the
  authority schedules ordinary independent v4 promotion, then rethrows the
  original asset error. No runtime/asset-ready receipt is admitted; a failing
  generic open returns no new session, while an already-open companion session
  remains available for recovery and retry.
- If finalizer also fails, do not schedule promotion and throw
  `AggregateError([assetError, finalizerError])`. Pre-tree and non-asset errors
  retain current rollback. Package-add tests prove the requested dependency
  remains in `package.json` after post-tree asset failure; finalizer-fault tests
  prove no trusted stamp.

### Child capability and deployment cutover

- Child admission is itself a command on the package FIFO. If a package/tree
  mutation was admitted first, spawn waits for its resulting attested epoch or
  error; a pending epoch retries ensure before spawn. `reserveChildAdmission`
  publishes a package-private reservation while its FIFO command stays pending.
  The caller performs no await: create the exact-plan port session, call the
  synchronous physical Worker spawn, attach cleanup, then `commit()`; any throw
  before physical spawn closes the session and aborts. After spawn returns, any
  attach/commit throw first terminates the unexposed child and disposes its
  session; `abortAfterChildSettlement(error, exited)` keeps the FIFO reservation
  until physical exit and session settlement. Termination/observation failures
  aggregate after the original post-spawn error. The success path never yields
  between reservation, port creation, spawn, supervision attachment, and
  `commit()`. Commit/abort is exactly-once, so a later tree mutation cannot
  overtake physical spawn or a failed unsupervised child. `not-required` follows
  the same reservation but creates no channel. The spawn call is the admission
  linearization point. It never replans from concurrently edited manifest/
  lockfile bytes. Project mismatch or unavailable state rejects package-internally as
  `PackageTreeUnattestedError {code:'EUNATTESTEDPACKAGETREE'}` and requires a
  successful install/reuse before child admission.
- Before each non-empty supervised child spawn, start one exact-plan
  `MessagePort` server and place its child endpoint under
  `rifty.shadow-assets.v1` on the URL `WorkerEntryDescriptor`. Attach peer
  cleanup before exposing the child handle.
- Node entry reads `readKernelEntryCapabilityPorts()` separately from ADR-0267
  bootstrap, constructs only `ShadowAssetRuntimeReader`, and passes it explicitly
  to Vite preparation before import. Missing required capability loud-throws
  `NotImplementedError('vite.esbuild.shadowAssets')`. Empty Vite 8 plans create
  no channel.
- Spawn failure, exit, kill, project close, Workbench close, and manager
  shutdown settle each port/session once without aborting shared manager flights.
- Only this joined item removes `deployment.wasm.esbuild` from root options,
  normalized owner input, strict owner protocol/bootstrap, host imports,
  `NodeWorkerRuntimeConfig`, recursive entry bootstrap, and
  `RIFTY_ESBUILD_WASM_URL`. Remove the current host seams in
  `playground-workbench-host.ts`, `workbench-vite-host-assets.ts`, and
  `playground-node-worker-runtime.ts`. SQLite stays host-owned.
- Atomically bump `NODE_ENTRY_BOOTSTRAP_PROTOCOL` from
  `rifty.node-entry/v1` to `rifty.node-entry/v2` in runtime-js and every
  owner/execSync/worker_threads builder, decoder, and test fixture. The v2
  host-runtime record has kernel/node/SQLite values and no esbuild value. Do not
  dual-read v1 or fall back to env; a node entry with v1, malformed v2, or
  v2/esbuild drift rejects before pre-entry. Foreign non-node protocols retain
  current `readNodeEntryBootstrapIfPresent() === null` behavior.
- Default `vite@8.0.16` plans empty: no ensure, capability, progress, or asset
  fetch. Explicit `viteVersion:'7.3.6'` plans esbuild 0.28.0 and drives the full
  store/capability path. Asset pins do not change project-definition identity.

### Teardown and measurement

- Update both `withOwnerClose` and `createCompanionOwnerClose`. Exact order:

  ~~~text
  boot:
  backend + retention -> OwnerVfsAuthority -> private asset storage
  -> ShadowAssetManager -> package authority -> controller ready

  project close:
  fence admission -> project runtime/children/ports
  -> package FIFO quiesce -> project asset sessions -> project flush

  owner close:
  project authority close -> package FIFO quiesce -> manager close/settlement
  -> final authority flush -> owner exit -> Web Lock release
  ~~~

  Every step is attempted; multiple failures aggregate in causal order. Cache
  is retained unless explicit clear succeeded.
- Real-browser cold STD benchmark uses the generic public Workbench root with
  explicit Vite 7.3.6. One discarded proxy/origin warm-up precedes five fresh
  Chromium contexts. Each measured `openProject` proves empty asset and tarball
  caches, STD receipt/storage class/set digest, close, and Web Lock release.
- Perf schema v3 always carries
  `shadowAssetColdFillMs.standard = measured-row|unmeasured-row`. A measured row
  records owner-monotonic `cache-check` through acknowledged `ready`,
  per-sample/median milliseconds, `memberBytes=13918738`, decoded packument,
  tarball and total response-body bytes, cache/origin regime, registry URL, and
  transport evidence. Missing/mixed/out-of-order proof is `unmeasured`. Eddy
  adds a matched row, not a different boundary.

## Observable proof

1. Generic public Workbench Vite 7.3.6 cold open emits ordered callback phases,
   returns a session only after receipt, then dev/build/preview/optimize consume
   zero runtime-network bytes. OPFS reload works offline while origin data
   remains.
2. Companion cold/rejected-snapshot open returns its session before install.
   First run visibly prints install plus asset phases and cannot spawn Vite
   before `ready`. Trusted/snapshot open reports readiness before project-opened.
3. Default Vite 8 opens/runs with `not-required` and zero manager ensure,
   capability, progress, or esbuild fetch.
4. Guest read/readdir/rm, snapshot/archive/export, SCM, reset, and
   `deleteProject` cannot see/remove the cache. Sequential projects reuse one
   verified object; acknowledged clear makes the next Vite 7.3.6 path miss.
5. Fail persistence after a package-add tree completes: command rejects
   `ESHADOWASSET`, requested manifest/lockfile and finalizer output remain, v4
   tree promotion may settle independently, but no runtime/asset-ready claim
   appears; an existing companion session remains recoverable. Fault finalizer:
   aggregate failure and no promotion.
6. Close project/Workbench during every ensure phase. Openings, children, ports,
   manager flights, flushes, and Web Lock settle; no late session/route appears.
7. Two pages contend: the lock loser touches neither package state nor asset
   cache. Crash releases the lock; replacement owner recovers verified state
   only.
8. Quota failure stays recoverable through public inspect/clear even after
   failed generic open. The rejected promise is public `RuntimeAssetError` with
   exact recovery/quota fields. Clear during opening/active rejects untouched;
   idle clear fences a concurrent open and returns acknowledged zeros.
9. Node-entry contract tests prove every recursive spawner emits v2, v1 and
   malformed v2 reject without env fallback, and v2 carries no esbuild host
   field while the separate entry capability remains available.
10. Asset-only and project-only persistence faults remain scope-isolated during
    acknowledgement; the final owner flush aggregates both. A package mutation
    racing child admission proves FIFO order and exact epoch selection; a
    manifest-only edit never manufactures a new tree plan. Switching A to a
    deferred-cold B cannot reuse A's epoch.
11. Fault before first tree mutation preserves a prior ready epoch; fault after
    destructive preparation but before `InstallTreeResult` leaves unavailable
    state and no stale child. Typed post-tree asset failure leaves the new exact
    plan pending and a later ensure can recover it.
12. On-disk v4 makes sync prefetch gating conservatively miss, then async check
    accepts only the matching exact lockfile hash. Warm prefetch never upgrades
    trust. First-materialization failure retries install; its first success
    consumes the decision and the second run does not prepend `npm install`.
13. Exact `package-lock.json` ingress demotes v4 without changing the installed
    tree epoch; a `node_modules`/ancestor ingress crosses the token-bound barrier
    before its first write. Fault supervision attachment and reservation commit
    after a real spawn: the unexposed Worker is terminated and observed before
    the FIFO admits a tree mutation.

## Parity cases

1. Explicit Vite 7.3.6 consumes the same verified descriptor bytes as direct
   manager and existing esbuild runtime parity.
2. Default Vite 8 remains asset-free and preserves its visible policy.
3. No capability name/frame/bytes appear in Node env, process IPC, stdio,
   `KernelProcessSpec`, deployment config, project snapshot, or export.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `torn-state` | owner boot/open/close fails around authority/manager/package/flush | no ready/session/lock leak; verified recovery only |
| `observable-order` | generic/snapshot project opens or child imports before readiness | impossible at named admission and entry publication barriers |
| `observable-order` | companion cold work starts during open or child starts before terminal ensure | open stays non-installing; first run remains visibly ordered |
| `quota-perm-fail` | retention probe, OPFS persist, or clear fails | best-effort/typed recovery; no false persistent claim |
| `quota-perm-fail` | asset/project persist reports contain sibling-scope paths | each acknowledgement filters its semantic scope; final flush aggregates all |
| `concurrent-same-key` | terminal/open/sequential child demand same asset | one owner flight/object; every waiter settles |
| `observable-order` | clear races opening/active/deleting/clear | one synchronous state claim; busy rejection or fenced idle clear |
| `observable-order` | companion delete races clear | shared root `deleting` claim; clear rejects busy before owner mutation |
| `observable-order` | package/tree mutation races child admission | one FIFO order; child sees resulting epoch or snapshots the prior exact epoch |
| `observable-order` | reservation continuation is delayed or physical spawn throws | FIFO remains held through sync spawn commit/abort; port/session settles once |
| `torn-state` | supervision attach or reservation commit throws after physical spawn | terminate/observe unexposed child and dispose session before releasing FIFO; original error first |
| `observable-order` | install mutation/progress escapes its owning operation | mutation fence; callback/signal stay with one open or terminal |
| `provenance-lie` | Vite/storage/transport/tree outcome drifts | exact plan, receipt, and owner facts drive result |
| `sibling-drift` | one recursive spawner/decoder remains on node-entry v1 or carries esbuild host config | atomic v2 contract suite; no dual read/env fallback |
| `sibling-drift` | generic, companion trusted/snapshot/cold, or later terminal path bypasses hook | all outcomes pass one FIFO readiness seam at their documented boundary |
| `lossy-aggregate` | lockfile or asset set changes under same count | exact byte/set digests invalidate only the right identity |
| `false-fallback` | sync prefetch check sees v4 but cannot hash lockfile | conservative miss only; async exact-byte check remains sole trust gate |
| `lossy-aggregate` | plan is recomputed from an edited/unattested lockfile at spawn | forbidden; owner-private attested epoch is the only child source |
| `provenance-lie` | active project/root changes while a prior epoch is ready | exact `{root,slug}` mismatch is unavailable; no cross-project lease |
| `sibling-drift` | owner asset failure crosses generic/companion/admin boundary | one sanitized discriminant reconstructs `RuntimeAssetError`; no internal cause/plan/path leak |
| `torn-state` | asset failure followed by finalizer/promotion failure | manifest honesty preserved; no false asset or tree claim |
| `torn-state` | install fails before vs after destructive tree preparation/result | prior epoch only for proven no-mutation; otherwise unavailable or exact new pending plan |
| `torn-state` | prepareEnsure/snapshot apply/prepareInstall/reset/switch/link mutates or throws | one token-bound barrier precedes each first write; no stale ready epoch |
| `sibling-drift` | shared mutation ingress classifies exact lockfile as none or tree ingress skips epoch barrier | package-only demotes v4; tree becomes unavailable before executor write |
| `observable-order` | first-materialization retry/success followed by another run | failure remains retryable; first success consumes; later run never reinstalls implicitly |

## Out of scope

- External runtime-adapter functions or generic Workbench extension registry.
- Other binary-backed packages; each needs a parity-proven runtime adapter.
- Cross-origin/shared-profile CAS, leases, eager GC, or automatic quota
  eviction.
- Non-Chromium or legacy non-Workbench Playground ownership.

## Decisions

- One origin-private content cache reused across Workbench lifetimes, with one
  live manager per physical owner; projects consume, never own it.
- Extend current operation/protocol/acquisition authorities; create no parallel
  state machine.
- Public semantic progress/admin; raw protocols and retention mechanics remain
  internal.
- Workbench integration starts only after all blockers land. Until then work
  stays in npm-client/shadow-registry or the isolated kernel item.
