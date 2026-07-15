---
area: distribution
status: ready
title: Workbench runtime assets — one origin-private cache, observable open, child capability
created: 2026-07-15
why: manager bytes are not a user capability until the final Workbench owner composes private storage, gates every project-open path, exposes progress/recovery, and removes esbuild from host deployment assets
user_story: As a Workbench Vite user, I want project open and npm install to make exact esbuild bytes visibly ready, reusable offline, and recoverable without exposing owner protocols
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-manager, npm-client/shadow-asset-message-port, kernel/worker-capability-ports, distribution/workbench-controllers]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/backlog/distribution/workbench-controllers.md]
code: [apps/playground/src/workbench/open-workbench.ts, apps/playground/src/workbench/workbench-owner-port.ts, apps/playground/src/workbench/project-definition.ts, apps/playground/src/workbench/project-materialization.ts, apps/playground/src/workbench/project-session.ts, apps/playground/src/workers/owner-storage.ts, apps/playground/src/workers/owner-package-state.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/vite-esbuild-runtime.ts, tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, tools/perf/src/aggregate.test.ts, perf/benchmarks.json]
---

## Context

This is the only item allowed to edit Workbench/Playground/runtime wiring. Its
blockers first freeze/extract the single physical owner, kernel bootstrap, and
npm-client manager interfaces. Before implementation, refresh only the
`code:` paths after Workbench extraction; the contracts below do not change.

No `workspaceId` exists in Workbench. Assets are immutable, content-addressed
and useful across sequential projects, so project-scoped copies would repeat the
13.3MiB cold cost without improving same-origin authority.

## Public interface

~~~ts
type RuntimeAssetStorageClass =
  | 'opfs-persisted'
  | 'opfs-best-effort'
  | 'memory-session'

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

interface Workbench {
  readonly runtimeAssets: WorkbenchRuntimeAssets

  openProject<T>(
    definition: ProjectDefinition<T>,
    options?: {
      readonly onRuntimeAssetProgress?: (
        progress: RuntimeAssetProgress,
      ) => void
    },
  ): Promise<ProjectSession<T>>
}
~~~

`openProject` progress is correlated to its private operation id and is
available before `ProjectSession` exists. Observer throws are reported but do
not alter acquisition. The semantic inspect/clear interface remains available
after a failed open; no raw owner/admin port is public.

`assetIndex` is zero-based canonical-plan order; `assetCount` is constant for
the operation. Per-asset phases preserve order but may omit `fetch`/`persist`
on a verified hit. `ready` emits exactly once, only after the required-set
pointer and storage acknowledgement. Empty plans emit nothing.

Inspection counts every semantic store entry in `entryCount`/`storedBytes`,
including temp/corrupt/orphan metadata; byte counts are decoded entry lengths,
not filesystem allocation. Verified object and ready-set counts include only a
currently valid hash/receipt/pointer chain. The shared npm tarball cache and
project trees are excluded. All numbers are non-negative safe integers.
Successful `clear()` returns the post-clear inspection with all counts/bytes
zero and the unchanged storage class. `inspect()` linearizes in the owner; when
a clear already owns the fence, inspection waits and returns its post-clear
state.

## Acceptance

- The final Workbench owner creates exactly one `ShadowAssetManager` after
  backend selection and an owner-born storage-retention probe, before package
  authority/owner readiness. Page config carries clone-safe deployment/policy
  data only; managers, callbacks, storage/source adapters, registry clients,
  errors, and signals never cross owner boot IPC.
- One root-scoped adapter maps semantic entries to
  `/.rifty/workbench/v1/runtime-assets/v1/{objects,receipts,ready,tmp}`.
  It captures raw backend authority before publishing project VFS access.
  Ordinary owner/guest/child VFS, absolute/traversal reads, recursive root rm,
  snapshots, exports, SCM, and project deletion cannot observe or mutate it.
- The cache is origin-private and shared by sequential projects under the
  existing exclusive `rifty:workbench:v1` Web Lock. `deleteProject()`
  retains it. `runtimeAssets.clear()` synchronously claims the Workbench only
  in idle state; opening/active project or another clear rejects
  `ProjectBusyError`. Owner fences admission, waits manager flights, clears,
  acknowledges, then returns to idle. A failed open returns to idle, preserving
  recovery. OPFS survives Workbench close while origin data exists; memory
  disappears. Browser origin-data deletion remains the outer reset.
- Storage write durability and browser eviction retention are separate facts.
  Owner snapshot exposes backend/write proof plus
  `persistent-granted|best-effort|session`. Asset storage class derives as
  `opfs-persisted|opfs-best-effort|memory-session`; only the first claims
  eviction resistance. No page-threaded `persistedAfter` is authoritative.
- Workbench root removes npm-derived esbuild from
  `deployment.wasm`, normalized owner input, strict boot protocol, host asset
  imports, and recursive runtime config. Host-owned SQLite remains. This is the
  dated narrow correction to ADR-0263/0231; npm-derived bytes are neither
  configuration nor host-bundle input.
- Default `projects.vite()` (`vite@8.0.16`) plans an empty esbuild asset set:
  no manager ensure, capability, progress, or asset fetch. Explicit
  `viteVersion:'7.3.6'` plans the exact esbuild 0.28.0 substitution and drives
  the full store/capability path. Project-definition identity excludes
  asset-set pins.
- Every Workbench acquisition arrival path uses one owner hook:
  fresh install, trusted existing tree, and verified snapshot. The hook plans
  from exact facts and awaits `ensure` before `project-opened` or runtime.
  No page/app catalog, unattested lockfile, or fast path bypass participates.
- Advance install claims to v4: retain v3 fields and add lowercase exact stored
  `package-lock.json` sha256. Fresh/snapshot outcomes carry it; promotion and
  trusted checks re-read/hash exact bytes. v1-v3, missing, edited, or mismatched
  bytes are a miss. Asset plan identity remains separate from tree identity.
- Only typed post-tree `ESHADOWASSET` becomes the acquisition authority's
  internal `post-tree-failure {treeResult, packageJsonText, lockfileSha256,
  error}`. It schedules ordinary independent v4 tree promotion, rethrows the
  asset error, admits no session, and never attests asset readiness. Other
  throws preserve pre-tree rollback.
- Owner starts a plan-scoped MessagePort server before each non-empty supervised
  child spawn and passes the child endpoint under
  `rifty.shadow-assets.v1` via ADR-0266. Bootstrap passes the client explicitly
  to Vite preparation before import. Missing capability loud-throws
  `NotImplementedError('vite.esbuild.shadowAssets')`.
- One child-session cleanup attaches before returning the handle. Spawn failure,
  exit, kill, project close, Workbench close, and manager shutdown settle each
  port exactly once without aborting shared manager flights.
- Terminal install renders the manager's same
  `cache-check|fetch|verify|persist|ready` phases. Pre-admission
  `openProject` renders typed progress through its callback. Ready UI shows
  storage class; best-effort/session warnings make no stronger claim. Typed
  quota/error UI exposes asset, phase, cause, attempts, used/required bytes,
  recovery, and acknowledged `runtimeAssets.clear()`.
- Owner readiness and teardown are ordered:

  ~~~text
  storage + retention probe
  -> private store adapter + owner authority
  -> ShadowAssetManager
  -> package authority
  -> owner ready

  project close:
  fence admission -> children/ports -> package quiesce
  -> asset sessions -> project flush (cache retained)

  Workbench close:
  project close -> manager shutdown/settlement -> final flush
  -> owner exit -> Web Lock release
  ~~~

- Real-browser cold STD benchmark uses the final public Workbench host with
  explicit Vite 7.3.6, not a legacy query preset. One discarded proxy/origin
  warm-up precedes five fresh Chromium contexts. Each run proves empty runtime
  asset cache and tarball-cache miss, STD receipt/storage class, exact set
  digest, Workbench close, and Web Lock release.
- Benchmark records monotonic owner-local `cache-check` through acknowledged
  `ready`, all samples/median, `memberBytes=13918738`, decoded packument,
  tarball and total response-body bytes, cache/origin regime, registry URL and
  HTTP transport evidence. Missing/mixed/out-of-order proof is `unmeasured`;
  schema v3 always carries the metric.

## Observable proof

1. Public Workbench with Vite 7.3.6 shows all cold phases, returns a session only
   after receipt, runs dev/build/preview/optimize, reloads offline from retained
   OPFS, and performs zero runtime asset requests.
2. Default Vite 8 opens with `not-required` and zero esbuild capability/fetch.
3. Guest read/readdir/rm, snapshot/export and `deleteProject` cannot see/remove
   the cache; sequential projects reuse one verified object. Explicit clear
   produces an acknowledged future miss.
4. Fail persist after tree completion: first open rejects `ESHADOWASSET` with
   no session; v4 tree promotion remains independent; repeat open reuses the
   tree and retries assets.
5. Close project/Workbench during every ensure phase. All openings, children,
   ports, manager flights, flushes and the Web Lock settle; no late session or
   route appears.
6. Two pages contend: the Web Lock loser touches neither package state nor the
   runtime asset cache. Crash releases the lock and replacement owner recovers
   only verified state.
7. Quota failure remains recoverable through public inspect/clear even when
   `openProject` never returned a session.
8. Clear during opening/active project rejects without touching storage. Idle
   clear fences a concurrent open, waits flights, returns an empty acknowledged
   inspection, and the next Vite 7.3.6 open performs one ordinary miss.

## Parity cases

1. Explicit Vite 7.3.6 consumes the same verified descriptor bytes as the
   direct manager and existing esbuild runtime parity suite.
2. Default Vite 8 path remains asset-free and keeps its visible Vite policy.
3. No capability name/frame/bytes appear in Node env, process IPC, stdio,
   Workbench deployment config, snapshot, or export.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `torn-state` | owner boot/open/close fails around manager/package/flush | no ready/session/lock leak; verified recovery only |
| `observable-order` | project opens or child imports before receipt/capability | impossible by owner admission and pre-entry ordering |
| `quota-perm-fail` | OPFS persist/clear fails | typed visible recovery; no false persistent claim |
| `concurrent-same-key` | install + sequential project/child demand | one owner flight/object; bounded waiters |
| `observable-order` | clear races opening/active project | synchronous busy rejection or one fenced idle clear; never live-session deletion |
| `provenance-lie` | Vite/default/storage/transport claim drifts | exact plan and owner-born facts drive public result |
| `sibling-drift` | fresh/existing/snapshot or terminal/open differs | one owner hook and shared progress/error vocabulary |
| `lossy-aggregate` | lockfile or asset set changes under same count | exact byte/set digests invalidate the right identity only |

## Out of scope

- External runtime-adapter functions or a generic Workbench extension registry.
- Other binary-backed packages; each needs its own parity-proven runtime adapter.
- Cross-origin/shared-profile CAS, leases, eager GC, or automatic quota eviction.
- Non-Chromium or non-Workbench legacy Playground ownership.

## Decisions

- One origin-private content cache reused across Workbench lifetimes, with
  exactly one live manager per physical owner; projects are consumers, not
  cache owners.
- Public semantic progress/admin interface; raw protocols remain internal.
- Workbench integration starts only after all blockers land. Until then,
  implementation stays confined to npm-client/shadow-registry or the isolated
  kernel item, preventing a rebase across active owner code.
