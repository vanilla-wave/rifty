---
area: distribution
status: ready
title: Workbench runtime-asset acquisition — attested tree readiness and child capability
created: 2026-07-17
why: package acquisition is not complete while its exact runtime assets are unavailable, and a child must never start from an unattested or concurrently replaced package tree
user_story: As a Workbench user, I want cold runtime-asset work to appear at the install boundary, finish before dependent code starts, and remain retryable without leaking owner protocols or silently reusing stale bytes.
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-message-port]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/adr/npm-client/0283-canonical-package-manifest-serialization.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md]
code: [apps/playground/src/workbench/public.ts, apps/playground/src/workbench/errors.ts, apps/playground/src/workbench/open-workbench.ts, apps/playground/src/workbench/owner-protocol.ts, apps/playground/src/workbench/workbench-browser-owner.ts, apps/playground/src/workbench/workbench-owner-port.ts, apps/playground/src/workbench/project-materialization.ts, apps/playground/src/workbench/playground.ts, apps/playground/src/workbench/internal/browser-workbench-composition.ts, apps/playground/src/workbench/internal/playground-workbench.ts, apps/playground/src/workbench/internal/playground-terminal-state.ts, apps/playground/src/workbench/vite-project-runtime.ts, apps/playground/src/workbench/node-project-runtime.ts, apps/playground/src/workers/workbench-owner-controller.ts, apps/playground/src/workers/workbench-owner-bootstrap.ts, apps/playground/src/workers/playground-project-authority.ts, apps/playground/src/workers/owner-package-state.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/package-install-finalizer.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/glue/project-deps.ts]
---

## Outcome

Extend the current app-local Workbench with one owner-private package-tree
epoch and two commands on its existing package FIFO: post-tree runtime-asset
readiness and child admission. Every trusted, snapshot-restored, or newly
installed tree reaches one exact asset plan before it becomes runnable. A
non-empty attested plan gives each supervised child a fresh, exact-plan
`MessagePort` session; an empty plan starts without a port.

Cold work stays at the operation that caused it. Generic open and reusable
companion open finish asset readiness before publishing the project. Deferred
companion first materialization keeps open non-installing, then shows install
and asset progress in the default terminal before spawning. Later terminal
installs use the same path.

Implement these semantics under `apps/playground` before Workbench package
extraction. The later extraction is a mechanical move of this implementation
and its interface-level tests. Do not introduce a package facade, parallel
owner controller, second acquisition queue, or extraction adapter.

## Public interface

`distribution/workbench-runtime-asset-storage` introduces the one nominal
`RuntimeAssetError` and `RuntimeAssetStorageClass`. This item extends that same
public interface only with progress/open options; it does not restate or define
a sibling failure type or error class.

~~~ts
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
  openProject<T>(
    definition: ProjectDefinition<T>,
    options?: WorkbenchProjectOpenOptions,
  ): Promise<ProjectSession<T>>
}
~~~

Acquisition uses the canonical storage item's fixed failure phases/messages for
cache check, fetch, verify, persist, and ready. An owner acquisition failure
crosses as exactly
`{name:'RuntimeAssetError',code:'ESHADOWASSET',message,phase,recovery,
requiredSetDigest?,assetId?,usedBytes?,requiredBytes?}`. Browser decoding
requires exact keys and that canonical phase message, then restores the public
prototype. Cause, stack, URLs, transports, tree result, exact plan/receipt,
paths, owner ids, and package identities never cross. Existing non-asset owner
errors retain their current wire.

`assetIndex` is zero-based canonical-plan order and `assetCount` is constant.
One asset preserves `cache-check -> fetch? -> verify -> persist?`; verified hits
may omit fetch and persist. `ready` emits once after the ready pointer/storage
acknowledgement. Empty plans emit no progress.

Root and companion open options are owned on the page. The callback itself
never crosses IPC. A callback throw is caught and logged once with its owning
operation id; it cannot reject acquisition, corrupt the pending map, or suppress
later phases.

## Progress ownership and protocol

- Extend the exact owner wire with
  `workbench:runtime-assets-progress {opId,progress}`. It is non-terminal and is
  valid only while the matching generic or companion open is pending.
- `workbench-owner-controller` creates an owner-local sink capturing that open's
  `opId`, then passes it explicitly through
  `ProjectMaterializer.open -> ProjectAcquisitionPort.ensure` or
  `PlaygroundProjectAuthority.openProject`. No global/current-operation slot may
  retain a sink.
- Root and companion request frames remain distinct. Their browser operations
  share one strict progress decoder. Unknown, duplicate, late, wrong-kind, or
  post-terminal progress is protocol failure.
- A terminal install never uses the page-open sink. It maps manager progress
  only to that terminal's captured PTY writer. The sink and abort signal are
  dropped at operation settlement.
- This item adds no public cache inspection, clear, storage handle, raw manager,
  callback registry, owner port, or progress subscription.

## One acquisition join

Add one named `post-tree runtime-asset readiness` seam inside the existing
`PackageAcquisitionAuthority` FIFO. Every successful tree-ready outcome crosses
it, including the early trusted-provenance return, verified snapshot apply, new
install, first-materialization reuse, and later terminal install. There is no
side call from Workbench runtimes and no second queue.

The seam receives the exact canonical plan and an optional receipt already
returned by the same install. It skips manager ensure only when that receipt
matches the plan's required-set digest. An empty plan publishes `not-required`
without calling the manager. A non-empty plan uses the manager installer from
the storage composition and resolves only after `ready(plan,receipt)`.

Each npm install passes one operation-scoped group:

~~~ts
interface InstallOptions {
  readonly shadowAssets?: {
    readonly installer: ShadowAssetInstaller
    readonly options?: ShadowAssetEnsureOptions
  }
  readonly onTreeMutationStart?: () => void
}
~~~

`signal` and `onProgress` belong to that one open or terminal command. Project
or terminal close aborts only its waiter; it does not abort a manager flight
still shared by another waiter. The source retains ADR-0201's no-progress
bound; Workbench adds no total cold-fetch deadline.

Every path obtains its exact plan and optional matching receipt through one
package-private package-acquisition producer seam before entering readiness.
Workbench never parses a lockfile for shadow planning or calls the planner.
The current npm-client composition has two producer paths: fresh install returns
the plan/receipt from its exact applied-substitution record; trusted-existing
and snapshot replay give exact stored lockfile bytes to npm-client's
lockfile-facts producer. Both return the same installer-neutral value contract.
A later native package-manager direction replaces this producer-side
composition, not the plan/receipt, manager/store, owner
readiness/epoch/admission, or child runtime reader. Stamp package count,
installed-name coincidence, app catalogs, project definition identity, and
terminal text never reconstruct a plan. No public producer interface is added.

## Owner-private attested tree epoch

`OwnerPackageState` is the sole owner of:

~~~ts
type OwnerPackageTreeEpoch = Readonly<{
  project: Readonly<{ root: string; slug: string }>
  sequence: number
  readiness:
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'not-required' }>
    | Readonly<{ kind: 'pending'; plan: ShadowAssetPlan }>
    | Readonly<{
        kind: 'ready'
        plan: ShadowAssetPlan
        receipt: ShadowAssetReceipt
      }>
}>
~~~

It is never placed in `ProjectAcquisitionPlan`, page/companion protocol,
snapshots, exports, env, stdio, or `KernelProcessSpec`. Every read requires an
exact canonical `{root,slug}` match. Project switch publishes `unavailable` for
the new project before a deferred-cold session can return, so project B cannot
reuse project A's epoch. Each replacement advances one monotonic safe-integer
sequence; exhaustion rejects before mutation.

One acquisition-token-bound `beginTreeMutation(project)` synchronously marks
the matching epoch unavailable while the FIFO excludes child admission. It is
idempotent for one token; project/token mismatch rejects before mutation. Call
it immediately before each first destructive write:

- `prepareEnsure` clear/seed;
- snapshot `prepared.apply()`;
- terminal `prepareInstall`;
- reset and project-switch clear;
- existing tree-demotion ingress;
- npm-client's exact once-before-link `onTreeMutationStart`.

Pure preflight/validation failure and proven no-op do not cross the barrier and
preserve the prior epoch. Any operation that crossed it and failed before a new
tree result leaves `unavailable` unless the typed post-tree rule below can name
the exact new plan.

Advance shared mutation impact to `none | package-only | tree`. Exact
`package.json` and exact `package-lock.json` writes are `package-only`: they
demote v4 trust but retain the currently installed tree epoch. `node_modules`,
an ancestor replacement/removal, or a combined mutation that can touch the
installed tree is `tree`: invoke `beginTreeMutation` before the shared
executor's first write and perform the stamp transition. A later tree-ready
outcome replaces the retained epoch.

Trusted/snapshot planning publishes `pending(plan)` before external ensure.
Successful empty-plan install publishes `not-required`; non-empty install
publishes `ready(plan,receipt)` atomically. No code may promote pending to ready
from a cache probe, child read, port connection, or inferred package state.

## Honest Workbench timing

- Generic `activateAndEnsure` retains current semantics: install/reuse and
  runtime-asset readiness happen during `openProject`; `ready` precedes
  `workbench:project-opened`; progress reaches only that open callback.
- Companion trusted-existing and valid-snapshot outcomes also ensure before
  `workbench:playground-project-opened`.
- Companion `firstMaterialization: install` and rejected-snapshot fallback keep
  ADR-0278: open returns the session/default terminal without installing or
  retaining the open callback. First `session.run()` writes `$ npm install`,
  performs tree install and asset readiness with terminal progress, then and
  only then admits the requested Vite/Node child.
- The first-materialization decision is owner terminal state, not a runtime
  closure. Failure leaves it retryable; the first successful materialization
  consumes it; subsequent runs execute only the requested runtime command.
- Every later terminal install crosses the same FIFO seam and exits zero only
  after its new required set is ready. Manifest edits do not invent a new tree;
  the next successful tree-ready operation replans and ensures it.
- Default Vite `8.0.16` has an empty plan: no manager ensure, progress, port, or
  asset fetch. Explicit Vite `7.3.6` plans esbuild `0.28.0` and exercises the
  full path. Asset pins do not alter project-definition identity.

## Typed post-tree failure

Recognize only the npm-client's nominal typed post-tree
`ShadowAssetInstallError` carrying `code='ESHADOWASSET'`, exact
`treeResult`, and exact `plan`; name/code duck typing is forbidden. Before
package-add rollback, preserve the exact post-install manifest/lockfile and run
`finalizePackageInstallFiles`.

On finalizer success, return the package-private outcome
`post-tree-failure {treeResult,packageJsonText,error}`. The v4 authority re-reads
and hashes the exact stored lockfile in its serialized promotion slot; no caller
supplies a digest. The
authority publishes `pending(error.plan)`, schedules ordinary independent v4
promotion, then rethrows the original asset error. It admits neither a ready
receipt nor a child. Generic open returns no new session; an already-open
companion session stays available for inspect and retry. `clear-and-retry` is
the existing root lifecycle: inspect → close the companion session → await
close → `workbench.runtimeAssets.clear()` → reopen the project → retry. Direct
clear while the session is active remains `ProjectBusyError`; acquisition does
not invent active clear or a second admin path.

If the finalizer also fails, schedule no promotion and throw
`AggregateError([assetError,finalizerError])` in that order. Pre-tree and
non-asset failures retain current rollback. A later successful ensure may
promote the exact pending plan to ready.

## Child admission and capability session

Child admission is a first-class command on the package FIFO. If a package or
tree mutation was admitted first, the child waits for its resulting epoch or
failure. `pending(plan)` performs/join ensure before reservation;
`unavailable` or project mismatch throws package-private
`PackageTreeUnattestedError {code:'EUNATTESTEDPACKAGETREE'}` and requires a
successful install/reuse.

`reserveChildAdmission(project)` resolves to a package-private reservation
while its FIFO command remains pending. The reservation snapshots exactly
`not-required` or `ready(plan,receipt)`; it never replans from current manifest
or lockfile bytes. From reservation until settlement the caller performs no
await:

1. for `ready`, create one exact-plan MessagePort server session and put its
   child endpoint at capability `rifty.shadow-assets.v1` on the URL
   `WorkerEntryDescriptor`; `not-required` creates no channel;
2. synchronously call the physical Worker spawn;
3. attach exit/kill/project-close/owner-close cleanup before exposing the
   handle;
4. call `commit()` exactly once.

Physical spawn is the admission linearization point. A throw before spawn
closes the session and aborts the reservation. A throw after spawn, including
supervision attachment or commit, first terminates the unexposed child and
disposes its session, then
`abortAfterChildSettlement(error,exited)` keeps the FIFO held until physical
exit and session settlement. Termination/observation failures aggregate after
the original error. A delayed continuation cannot let a later tree mutation
overtake spawn. Commit and both abort paths are mutually exclusive and
exactly-once.

Apply parent-side admission to owner child bin, Node, and dev-server spawners.
This item ends after the exact endpoint is transferred and its peer/session is
registered with the supervised child. Child-side capability decoding, runtime
reader construction, and Vite injection belong only to the cutover item; the
transitional host esbuild field remains until that atomic change.

Spawn failure, exit, kill, project close, Workbench close, manager shutdown,
and peer protocol failure settle each reservation/port session once. Closing a
child session removes only that peer and never aborts shared manager flights.

## Teardown order

This item extends the current owner lifetime without replacing it:

~~~text
project close:
fence admission -> project runtime/children/ports
-> package FIFO quiesce -> project flush

owner close:
project authority close -> package FIFO quiesce
-> storage-owned manager close -> final authority flush -> owner exit
~~~

Every stage is attempted; multiple failures aggregate in causal order. The
storage item owns manager/store close and cache retention. This item owns child
session registration, admission fencing, and FIFO settlement.

## Acceptance

### Contract + RED

- First checkpoint fixes the public progress/error surface, epoch transitions,
  mutation barriers, timing boundaries, reservation lifecycle, and every fault
  row in failing tests before implementation.
- RED demonstrates the current trusted/snapshot/cold/terminal bypasses, stale
  epoch/admission races, and retry/consume-once gap through the existing owner
  interfaces and a real supervised Worker boundary. Source greps and a fake
  child are not evidence.

### Final + GREEN

- Implement only through the existing package FIFO, `OwnerPackageState`, root
  operation/protocol, and supervised child seams. Every RED case and the
  observable proofs below pass without a second queue, epoch, or facade.
- One committed SHA passes focused browser/fault suites and `pnpm pr:check`;
  Final+GREEN review has zero correctness blockers.

### Observable proof

1. Generic public Workbench Vite 7.3.6 cold open emits ordered callback phases
   and returns only after the exact receipt. Its next child reservation transfers
   one matching endpoint and attaches peer cleanup before publishing the child;
   child-side Vite consumption remains the cutover proof.
2. Companion cold/rejected-snapshot open returns before install. First run
   prints install plus asset phases and cannot physically spawn before ready;
   its first success is consumed and the second run does not prepend install.
3. Companion trusted/snapshot open proves readiness before project-opened.
   Default Vite 8 stays `not-required` with zero manager call/progress/channel.
4. Trusted, snapshot, new install, deferred first install, and later terminal
   install each cross the same named readiness seam in sibling tests.
5. A manifest-only or lockfile-only edit demotes v4 but retains the current
   tree epoch. A tree ingress crosses the barrier before its first write.
6. Switching ready project A to deferred-cold B publishes B unavailable; no B
   child can receive A's plan or receipt.
7. Failure before mutation preserves the prior ready epoch. Failure after
   destructive preparation leaves unavailable; typed post-tree asset failure
   with successful finalization leaves only the exact new plan pending.
8. Post-tree package-add asset failure preserves the requested dependency and
   finalizer output, may promote v4 independently, rejects the operation, and
   admits no ready child. Finalizer failure aggregates and creates no claim.
9. An active companion post-tree failure remains inspectable and retryable.
   Clear-and-retry first closes the session, then clears from root idle, reopens,
   and retries; direct active clear rejects without owner mutation.
10. A package mutation racing child admission follows FIFO order. A delayed
   reservation, spawn throw, attachment throw, and commit throw each prove the
   stated linearization and cleanup behavior with no unsupervised child.
11. Close during every ensure and reservation phase settles opens, terminals,
    child handles, ports, FIFO, and owner lifetime without a late project or
    child publication.
12. Callback throw, late progress, wrong op id, and an owner asset failure prove
    observer isolation, strict protocol failure, and exact public error fields
    without internal evidence.

## Parity cases

1. Explicit Vite 7.3.6 produces the same canonical asset plan and ready receipt
   as direct planner/manager contracts; the reservation cannot substitute a
   different descriptor or receipt.
2. Default Vite 8 remains asset-free and preserves its visible start behavior.
3. The additional readiness work changes no npm tree, manifest, lockfile,
   command output, or process exit compared with the same install on Node.
4. Capability name, frames, plan, receipt, and bytes never appear in Node env,
   process IPC, stdio, `KernelProcessSpec`, project snapshots, or export.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `observable-order` | generic/snapshot open publishes before readiness | impossible at one post-tree FIFO seam |
| `observable-order` | companion cold install starts at open or child starts before terminal ready | open remains non-installing; first run remains visibly ordered |
| `observable-order` | active companion receives `clear-and-retry` | direct clear rejects; close settles before root clear/reopen/retry |
| `observable-order` | install mutation/progress escapes its operation | token-bound barrier; callback/signal/sink dropped at settlement |
| `observable-order` | package/tree mutation races child admission | one FIFO order and one exact epoch snapshot |
| `observable-order` | reservation continuation delays or physical spawn throws | FIFO remains held; session settles once |
| `torn-state` | supervision attach or commit throws after spawn | terminate/observe hidden child before FIFO release; original error first |
| `torn-state` | ensure fails before vs after destructive mutation | preserve only proven untouched epoch; otherwise unavailable or exact pending |
| `torn-state` | typed asset failure followed by finalizer/promotion failure | manifest honesty; no false ready or tree claim |
| `torn-state` | close during ensure/reservation/child start | all waiters, sessions, children, and FIFO settle exactly once |
| `concurrent-same-key` | open/terminal/children demand one required set | shared manager flight; independent waiter/session settlement |
| `provenance-lie` | Workbench infers a plan from count, catalog, text, or edited lockfile | forbidden; only the producer's exact applied-evidence value enters readiness |
| `provenance-lie` | project/root changes while prior epoch is ready | exact `{root,slug}` mismatch is unavailable |
| `lossy-aggregate` | package or asset set changes under same count | exact lockfile/set digests select the new plan |
| `lossy-aggregate` | spawn replans after concurrent manifest edit | forbidden; reservation's attested epoch is sole source |
| `sibling-drift` | trusted/snapshot/cold/later terminal path bypasses readiness | finite sibling sweep through one seam |
| `sibling-drift` | one owner child spawner bypasses reservation or cleanup | bin/Node/dev-server contract suite |
| `sibling-drift` | one Workbench open drops options/progress/error prototype | root, companion, facade, browser, controller contract suite |
| `sibling-drift` | shared mutation ingress misclassifies lockfile/tree | package-only demotes v4; tree fences before first write |
| `observable-order` | first-materialization failure/success/later run | retry on failure; first success consumes exactly once |

## Out of scope

- Private storage layout, persistence classification, inspection, clear, raw
  store operations, and admin lifecycle; the storage blocker owns them.
- Install-stamp v4 encoding/checking and redundant warm Eddy prefetch; the v4
  blocker owns them.
- Catalog/plan construction, manager/source algorithms, and MessagePort wire
  implementation; consume their ready interfaces without duplicating them.
- Native package-manager adoption or a public plan-producer interface; this
  item defines only the package-private acquisition seam and current npm-client
  composition.
- Child-side capability decoding, runtime-reader injection, Vite consumption,
  removing `deployment.wasm.esbuild`, host imports/env seams, or bumping
  `rifty.node-entry/v1` to v2. The deployment-cutover item owns that atomic
  change; the transitional field remains until then.
- Cold benchmark schema or measurement.
- Workbench package extraction, package exports, publish acceptance, alias
  retirement, external registries, Sass, and selective CI.
- Generic runtime adapters, automatic capability inheritance, or binary-backed
  packages without their own parity-proven adapter.

## Decisions

- Implement behavior once on the current app-local Workbench; later extraction
  moves it mechanically and does not layer a second interface.
- `OwnerPackageState` owns the epoch; `PackageAcquisitionAuthority` owns all
  ordering. Runtimes and child spawners consume reservations only.
- The package-acquisition producer owns fresh/replay planning. Workbench accepts
  only its installer-neutral exact value and never parses package-manager
  lockfiles for shadow planning.
- Install completion means exact runtime-asset readiness. Generic/reusable open
  pays before publication; ADR-0278 deferred first materialization pays visibly
  at first run.
- Physical spawn is child-admission linearization. The FIFO spans synchronous
  spawn plus supervision commit/abort, never an await-sized race window.
- Public surface is semantic progress and sanitized failure only. Plans,
  receipts, epochs, ports, and owner ids remain private.
- Contract+RED and Final+GREEN review this slice independently. Every fault row
  receives a fault test; all finite acquisition and spawner siblings are swept
  in the same PR.
