---
area: distribution
status: ready
title: Workbench runtime-asset storage — private owner cache and public recovery
created: 2026-07-17
why: the path-neutral manager needs one Workbench-owned durable store whose bytes are private from projects while cache state and recovery remain observable to users
user_story: As a Workbench user, I want runtime-asset cache usage and clear recovery exposed without letting projects, snapshots, or host configuration reach the owner's asset bytes
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-manager]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md]
code: [apps/playground/src/workbench/public.ts, apps/playground/src/workbench/errors.ts, apps/playground/src/workbench/open-workbench.ts, apps/playground/src/workbench/owner-protocol.ts, apps/playground/src/workbench/workbench-browser-owner.ts, apps/playground/src/workbench/workbench-owner-port.ts, apps/playground/src/workbench/internal/playground-workbench.ts, apps/playground/src/workbench/internal/browser-workbench-composition.ts, apps/playground/src/workers/workbench-owner-controller.ts, apps/playground/src/workers/workbench-owner-bootstrap.ts, apps/playground/src/workers/workbench-owner-storage.ts, apps/playground/src/workers/owner-storage.ts, apps/playground/src/workers/owner-vfs-authority.ts, apps/playground/src/workers/workbench-project-store.ts, apps/playground/src/workers/workbench-project-vfs.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/workers/playground-project-authority.ts]
---

## Context

`ShadowAssetManager` deliberately knows semantic entries, acknowledgements,
and storage class but no Workbench id, project root, physical path, OPFS policy,
or owner protocol. Current app-local Workbench on `main` already has the needed
composition seam: one selected backend, one `OwnerVfsAuthority`, rooted project
views, one public project-operation state machine, and one strict owner
protocol/pending-operation map.

This item composes the manager at that seam without waiting for package
extraction. It owns private storage, retention classification, admin
inspection/clear, public error projection, and manager shutdown only. It does
not join package acquisition, expose progress, admit children, remove host
esbuild deployment, or change the node-entry protocol.

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

interface Workbench {
  readonly runtimeAssets: WorkbenchRuntimeAssets
}
~~~

`RuntimeAssetError` is exported through `workbench/public.ts`. Its constructor
sets `name = 'RuntimeAssetError'`, snapshots/freezes optional data, and derives
`message` only from this package-private table:

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

Only `inspect|clear|close` originate in this item; the complete accepted public
type is fixed now so later acquisition work does not revise the interface.
`RuntimeAssetFailure` accepts no message, cause, stack, URL, path, owner id,
transport, plan, receipt, or tree result.

Inspection counts every semantic store entry and decoded byte, including temp,
corrupt, and orphan state. Verified-object and ready-set counts include only a
valid object/hash/receipt/pointer chain. npm tarballs and project trees are
excluded. Counts are non-negative safe integers. Successful `clear()` returns
the acknowledged all-zero inspection with unchanged `storageClass`.

## Owner composition and storage contract

- `installWorkbenchOwnerStorage` remains the only backend selector. Move/reuse
  `probeStoragePersistence` inside owner boot; page boot sends only the
  clone-safe `required|preferred|ephemeral` policy. Retention-probe absence or
  failure under either durable policy reports best-effort, never a false
  persistent grant. `required` rejects only when durable OPFS cannot open or
  its bounded write/flush durability proof fails; browser retention permission
  is not write durability.
- Construct exactly one
  `OwnerVfsAuthorityComposition(syncMirror())`. Before any project store or
  project-rooted view, construct one path-neutral `ShadowAssetStorage` adapter
  over its private `authority`, mapping semantic entries only to:

  ~~~text
  /.rifty/workbench/v1/runtime-assets/v1/objects
  /.rifty/workbench/v1/runtime-assets/v1/receipts
  /.rifty/workbench/v1/runtime-assets/v1/ready
  /.rifty/workbench/v1/runtime-assets/v1/tmp
  ~~~

  The raw installed backend never escapes owner boot and no second VFS
  authority or path-check state owner is created.
- Construct one owner-local standard source and one `ShadowAssetManager` after
  storage/authority and before current package authority/controller readiness.
  Keep the manager private in owner composition. This item exposes only its
  admin operations and close; later items may receive its existing
  least-authority installer/runtime-reader views without changing storage.
- The same physical composition serves generic and Playground companion
  Workbench. Owner callbacks, manager/source/storage objects, registry client,
  signals, and errors never cross boot IPC.
- Guest/project/owner-child VFS absolute or traversal access, recursive rm,
  project reset/delete, snapshots, archive/export, and SCM cannot observe,
  copy, or mutate the asset root. `deleteProject` retains it. Sequential
  projects and later Workbench lifetimes reuse OPFS bytes under the existing
  origin Web Lock; memory bytes last only for the owner session.

### Scope-aware durability

- One `OwnerVfsAuthority` remains the persist-ledger owner. Asset adapter
  mutation acknowledgement examines the full ledger through `anyFailure` and
  rejects only an unhealed path at/under the semantic asset root. It never
  decides from the bounded failure sample.
- Replace `ProjectMaterializationOwner.waitForDurability(revision)` with the
  scope-bearing
  `waitForDurability({projectKey,revision})`. The store validates the captured
  key/revision and matches only that key's exact project and stage containers;
  every materializer, delete, and public `awaitDurability()` caller passes its
  captured project key. No active/current-project slot selects persistence
  scope after an await.
- Both project and asset acknowledgement use one helper: call full-ledger
  `report.anyFailure(predicate)` when present; otherwise scan only when
  `report.total === report.failures.length`. A truncated report without
  `anyFailure` is ambiguous and rejects loudly, never proves a scope clean.
  An asset-only failure cannot poison project durability, and a project-only
  failure cannot acknowledge or reject an asset publication.
- The final owner flush remains global and aggregates every unhealed scope.
  Scope filtering is an acknowledgement rule, not a second ledger, flush, or
  durability claim.
- `runtimeAssets.inspect()`, not `OwnerStorageSnapshot`, exposes asset
  retention. `opfs-persisted` requires durable OPFS plus confirmed
  `persistedAfter`; other durable OPFS is `opfs-best-effort`; intentional or
  fallback memory is `memory-session`.

## Public state and owner protocol

- Add `clearing {ownerPromise}` to the existing root `ProjectOperation` union.
  `clear()` validates and claims `idle` synchronously before its first await.
  Opening, active, deleting, another clear, closing, and closed observe the
  existing `ProjectBusyError`/`ClosedHandleError` priority before owner
  mutation. Failed clear restores idle; failed open also restores idle so
  recovery remains reachable.
- Route generic and companion delete through one package-private
  `deleteProjectWithOwner` root operation which claims `deleting`
  synchronously. The companion may not call its catalog owner directly, so
  delete and clear share the same state owner.
- `inspect()` is read-only during idle/opening/active/deleting/clearing and
  rejects `ClosedHandleError` once close starts. It linearizes in owner request
  order: an inspect behind an already-claimed clear sees post-clear zeros.
- Extend the exact-key owner protocol and browser pending map with only:

  ~~~text
  page -> owner  workbench:runtime-assets-inspect {opId}
  page -> owner  workbench:runtime-assets-clear {opId}
  owner -> page  workbench:runtime-assets-inspected {opId, inspection}
  owner -> page  workbench:runtime-assets-cleared {opId, inspection}
  ~~~

  Existing `workbench:failure {opId,error}` remains the sole terminal failure.
  Duplicate/unknown/late ids, wrong terminal types, extra keys, unsafe counts,
  or a terminal after settlement are protocol failures and poison/close the
  owner port according to its current policy.
- Admin/store failures are sanitized to exactly
  `{name:'RuntimeAssetError',code:'ESHADOWASSET',message,phase,recovery,
  requiredSetDigest?,assetId?,usedBytes?,requiredBytes?}`. The browser strict
  decoder requires the fixed message and reconstructs the public prototype.
  Internal `ShadowAssetStoreError`, causes, stacks, paths, owner ids, and raw
  manager messages never cross. Existing non-asset failures retain exact
  `{name,message}` behavior.

## Lifecycle

- Idle clear fences new project admission, lets the manager settle flights
  admitted before its claim, clears semantic storage, awaits storage
  acknowledgement, then inspects and returns zeros. It never clears npm
  tarballs or projects. Manager clear failure maps to public
  `RuntimeAssetError` and leaves the root state idle for retry.
- Owner close fences public operations, closes current project authority,
  quiesces current package work, closes the manager (which closes source then
  storage), performs the final global authority flush, then exits and releases
  the Web Lock. Every step is attempted; multiple failures aggregate in causal
  order. Repeated close shares one settlement.
- Boot failure after manager construction runs the same applicable cleanup.
  OPFS asset bytes are retained unless an explicit clear was acknowledged;
  memory-session bytes disappear with the owner.

## Acceptance

### Contract + RED

- First commit adds failing real-manager/real-VFS storage contracts, browser
  owner-protocol/admin-state tests, and persistence fault tests. RED proves the
  current Workbench has no public admin surface, no private semantic adapter,
  no clearing state, and global durability reports can cross-poison scopes.
- Manager/store behavior is exercised through the published manager interface
  with Memory VFS and the real SyncMirror/OPFS pair. Workbench protocol and
  lifecycle are exercised in the browser owner harness; the unit under test is
  never mocked.

### Final + GREEN

- Implement on the current app-local Workbench paths listed in `code:`. Do not
  create an extraction compatibility layer, parallel controller, second VFS,
  or page-owned cache.
- Focused storage/admin/protocol/fault suites plus a real-browser Workbench
  acceptance pass. One committed SHA passes `pnpm pr:check`; Final+GREEN review
  has zero correctness blockers.

## Observable proof

1. In a fresh browser origin, the real manager publishes a verified semantic
   object/receipt/ready chain through the owner-private adapter. Public
   `workbench.runtimeAssets.inspect()` reports its exact storage class/counts;
   guest/project reads, traversal, export, snapshot, SCM, reset, and delete
   cannot reveal it.
2. Close and reopen Workbench on durable OPFS: inspection reports the same
   verified chain and sequential projects share it. Ephemeral/memory reopen is
   empty and reports `memory-session` without claiming persistence.
3. Public acknowledged clear returns exact zeros, preserves storage class, and
   leaves projects/tarball cache untouched. The next real manager lookup is a
   miss. Delete alone retains the chain.
4. Clear racing open/active/delete/clear loses at the synchronous root claim
   with the existing busy error. Inspect queued behind clear sees zeros. A
   failed clear restores idle and remains publicly retryable.
5. Inject an asset-only and then project-only persist failure in the real
   authority. Each local acknowledgement observes only its own scope; final
   close reports the aggregate. No operation claims false durability.
6. Quota/permission failure reconstructs a public `RuntimeAssetError` with
   exact phase/recovery/quota fields and no cause/path/owner detail. Closing
   after manager/store faults attempts all later cleanup and releases the Web
   Lock only after settlement.
7. Two tabs race the same origin Web Lock. The loser constructs no manager,
   source, or storage adapter and touches neither package state nor asset cache.
   After a winner crash releases the lock, a replacement owner admits only a
   fully verified object/receipt/pointer chain and reports residue honestly.

## Parity cases

1. The private cache is not a Node filesystem mount: project `fs`, snapshots,
   archives, SCM, and recursive rm observe the same rooted project namespace
   and errors with or without cached runtime assets.
2. Project delete/reset retains its existing Node-visible file effects and
   cannot remove owner metadata outside the rooted project capability.
3. Cache admin failure affects only the explicit Workbench admin/close promise;
   it never fabricates success for a project filesystem operation or rewrites
   a Node-visible error.

## Fault matrix

`OwnerVfsAuthority` is the sole storage mutation/persist-ledger owner. The
runtime-asset adapter, project materializer, host/project writers, reset/delete,
snapshot/archive/SCM, and final owner flush all use that authority; only their
acknowledgement predicates differ. Root `ProjectOperation` is the sole public
open/delete/clear/close serializer; manager owns its internal
open/clearing/closing state.

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `quota-perm-fail` | OPFS retention probe absent/rejects | both durable policies report best-effort, never persisted; only OPFS open/write proof can reject required |
| `quota-perm-fail` | asset persist report contains project-only failure | asset acknowledgement ignores sibling scope; final flush retains it |
| `quota-perm-fail` | project persist report contains asset-only failure | project acknowledgement ignores sibling scope; asset operation/final flush owns it |
| `torn-state` | object/receipt/pointer write or acknowledgement fails | manager exposes no valid ready chain; inspection reports actual residue |
| `torn-state` | boot/close fails between manager, package authority, flush, and owner exit | every admitted resource settles; no session or Web Lock leak |
| `concurrent-same-key` | manager write/inspect/clear/close overlap | manager state machine linearizes; no post-clear stale success |
| `concurrent-same-key` | two owner boots race or winner crashes | lock loser has zero cache/package effects; replacement verifies before ready |
| `observable-order` | clear races open/active/delete/clear/close | root state claims synchronously; loser fails before owner mutation |
| `observable-order` | companion delete bypasses root deleting state | forbidden by shared `deleteProjectWithOwner`; clear sees busy |
| `corrupt-input` | temp/orphan/corrupt receipt/pointer exists | total counts remain honest; verified/ready counts exclude invalid chain |
| `sibling-drift` | generic and companion admin/error/delete paths diverge | one protocol validator, public error projection, and root operation owner |
| `provenance-lie` | durable OPFS lacks confirmed persistent grant | reports `opfs-best-effort`, never `opfs-persisted` |
| `lossy-aggregate` | bounded persist sample omits a failing path in the requested scope | full-ledger predicate decides, or an ambiguous truncated report rejects loudly |

## Out of scope

- Package-acquisition readiness, operation progress/cancellation, install
  timing, post-tree asset failure, and tree epochs are not wired here. The
  existing install/reuse behavior remains intact; no empty receipt or fake
  ready state is introduced.
- MessagePort runtime reads, child capability/session lifecycle, Vite asset
  consumption, removal of `deployment.wasm.esbuild`, and node-entry v2 remain
  compat ❌ until their ready items land. Missing future capability use must
  loud-throw at its owning runtime seam, never fall back to cache paths.
- External storage/source/registry adapters, cross-origin CAS, automatic GC or
  quota eviction, and public raw entry access are unsupported. An attempted
  external runtime-asset adapter must loud-throw
  `NotImplementedError('workbench.runtimeAssets.externalAdapter')`; unknown
  config is never silently ignored.
- Non-Chromium and multiple simultaneous Workbenches per origin remain outside
  Workbench v0 and retain their existing loud capability/lock failures.

## Decisions

- ADR-0249 fixes one origin-private cache and one live manager per physical
  owner; projects consume neither raw paths nor manager objects.
- Current app-local Workbench is the implementation seam. Later package
  extraction mechanically moves this module; it does not block this item or
  justify a compatibility layer.
- Storage privacy comes from one private owner authority plus rooted project
  capabilities, not a captured raw backend or magic guest-path filter.
- Public recovery is semantic `inspect()/clear()` with one sanitized error
  vocabulary. Retention and raw owner protocols remain internal.
- Scope-aware acknowledgement and final global flush are views of one ledger,
  not additional state owners.
