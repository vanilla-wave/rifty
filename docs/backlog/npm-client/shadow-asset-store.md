---
area: npm-client
status: ready
title: Owner-managed shadow assets — exact set, verified readiness, workspace-private store
created: 2026-07-13
why: executed esbuild.wasm ships outside npm provenance; the first CAS proposal also returned install success before readiness and put workspace data in profile-wide /.rifty
user_story: As a Vite user, I want npm install to make the exact esbuild runtime bytes honestly ready for offline use, with visible provenance and recovery
epic: honest-shadow-substitutions
blocked_by: [kernel/worker-capability-ports]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/npm-client/0258-structured-install-acquisition-provenance.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md, docs/adr/runtime-js/0231-host-owned-bootstrap-config-for-recursive-node-workers.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/backlog/playground/multi-tab-undefined-behavior.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/index.ts, packages/npm-client/src/fetch-and-unpack.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/shadow-shims.ts, packages/runtime-js/src/ipc/install-process.ts, tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, tools/shadow-registry/src/install-artifact-recipe.ts, apps/playground/src/boot.ts, apps/playground/src/App.tsx, apps/playground/src/glue/playground-node-worker-runtime.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/glue/install-stamp.ts, apps/playground/src/glue/install-stamp-authority.ts, apps/playground/src/glue/scoped-vfs.ts, apps/playground/src/glue/project-deps.ts, apps/playground/src/workers/owner-vfs-authority.ts, apps/playground/src/workers/owner-package-state.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/node-worker-runtime-config.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/vite-esbuild-runtime.ts, tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, tools/perf/src/aggregate.test.ts, .github/workflows/ci.yml, perf/benchmarks.json]
---

## Context

ADR-0249 records the recut; ADR-0266 is its kernel prerequisite. Today
`playground-node-worker-runtime.ts` imports `esbuild-wasm/esbuild.wasm?url` and
ADR-0231 carries it as `RIFTY_ESBUILD_WASM_URL`; the registry cannot declare
runtime assets and no owner asset authority exists. Logical `/.rifty/*` is
profile-wide, while applying `/.rifty-private/*` through current `ScopedFsSync`
would wrongly place it inside the guest workspace.

## Acceptance

- Registry entries map every admitted exact public version to descriptors:
  `{id, source {name, version, integrity}, member, memberSha256, memberSize,
  maxTarballBytes, maxUnpackedBytes}`. The esbuild map is generated from
  `esbuild-runtime-policy.json`; the drift gate covers every field. Unmapped
  admitted versions loud-throw the ADR-0249 `NotImplementedError`.
- Substitution returns `AppliedSubstitution[]` with catalog id/digest, public
  name, resolved exact version, substitution id, and runtime-adapter id.
  One pure pre-mutation planner derives these from exact resolved versions at
  install or a lockfile whose exact bytes digest is carried by the trusted tree
  claim. Advance ADR-0261 to `InstallStamp.version:4`; retain its v3 fields and
  add `lockfileSha256`, lowercase hex sha256 of exact stored
  `package-lock.json` bytes. Fresh-install and snapshot-plan outcomes carry the
  digest; final promotion and trusted check re-read/hash the stored bytes. v1-v3,
  missing, or mismatched bytes are a miss and run normal acquisition.
  Fresh install uses this planner in npm-client; an injected owner hook uses it
  before `PackageAcquisitionAuthority` returns `existing` or `snapshot`, then
  awaits current ensure. No fast path bypasses assets; no unattested lockfile,
  app-global catalog, or semver inference participates. Repeated explicit `npm
  install` keeps normal reconciliation; no asset-only command is promised.
- Across composed catalogs and baked overrides, an asset source package/version
  cannot match a substitution trigger. Construction rejects it as
  `ESHADOWASSETSOURCE`; Eddy raw-source resolution is not implied.
- npm-client exports `createShadowAssetManager` and its port/adapter types. The
  workspace owner constructs one after backend boot from a private-store
  capability, actual backend, and a separately threaded browser persistence
  grant, then injects it through `InstallOptions.shadowAssets`. Omission is
  valid only for an empty required set; otherwise planner throws
  `NotImplementedError('npm.install.shadowAssets')` before tree mutation.
- `ShadowAssetManager` owns single-flight, transports, learned pins,
  verification, publish, receipts, retention, and recovery. Its only consumer
  port is `ensure`, `readVerified`, and `inspectReceipt`; direct in-owner,
  async adapter for supervised children, in-memory adapter for tests. No child
  accesses private VFS paths or starts an independent fetch. An owner-admin
  port provides `inspectUsage` and `clearWorkspaceCache` to UI only.
- Child adapter uses a dedicated async MessagePort protocol with request id,
  `read|progress|result|error|cancel` frames, deadline, and disposal rejection.
  It transfers a response-owned `ArrayBuffer` capped by descriptor size; the
  1MiB SAB sync-RPC is forbidden for asset bytes. Cancelling one waiter does
  not abort a shared manager flight still used by another caller.
- npm-client exports
  `SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1'`. After planning a
  supervised consumer's exact set, owner starts `port1` before spawn and passes
  `port2` under that key through ADR-0266 `capabilityPorts`.
  `node-entry-bootstrap` reads the published key and explicitly passes the
  adapter through `prepareViteCli` to `prepareViteEsbuildRuntime`; asset bytes
  are removed from `NodeWorkerRuntimeConfig`, `RIFTY_ESBUILD_WASM_URL`, Node
  `process`, and Node IPC. A required runtime without the capability
  loud-throws `NotImplementedError('vite.esbuild.shadowAssets')`. Owner attaches
  idempotent session cleanup to child exit before returning its handle. Spawn
  failure closes both ends; exit/kill disposes the owner session without
  aborting shared flights. Child dispose rejects local requests, best-effort
  cancels, then closes. Graceful manager shutdown sends terminal error then
  closes; abrupt owner death remains bounded by the client deadline.
  `serve:true` termination relies on the already-attached owner cleanup.
- Before workspace scoping, one composition root closes over the raw backend.
  It validates the exact non-empty well-formed `workspaceId` and derives one
  injective `workspaceStorageKey`: canonical
  `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` ids stay exact; every other admitted id is
  `~` plus unpadded base64url of its exact UTF-8 bytes. Guest and private roots
  both use this key; lossy `_` replacement is forbidden. The root returns only
  the guest-scoped VFS plus a private store capability rooted at
  `/.rifty-private/workspaces/<workspaceStorageKey>/shadow-assets/v1/{objects,receipts,ready,tmp}`,
  a raw-root sibling of the guest workspace. Raw FsSync never escapes that
  closure or enters ordinary `OwnerVfsAuthority`. Guest reads/readdir/rm
  (including `/`), snapshots, exports, and logical `/.rifty` cannot reach it.
  Explicit workspace-cache clear removes the private sibling; durable workspace
  deletion removes both. Project deletion retains workspace-shared assets. No
  ensure/update path sweeps data.
- A hit re-verifies member sha256. A miss first tries a valid tarball-cache
  entry, then configured bounded transport. Extraction accepts one matching
  regular file and rejects missing/duplicate match, links, unsafe path, size
  mismatch, SRI/hash mismatch, or cap breach before trust.
- STD cache miss resolves exact `source.name@source.version` through the injected
  registry client and active registry/auth config. It requires manifest
  name/version and `dist.integrity` to equal the descriptor, then feeds
  `dist.tarball` plus declared SRI to `fetchAndUnpackToCache`; catalogs bake no
  registry URL. A valid SRI-keyed tarball-cache hit skips packument resolution.
- Publish protocol: unique temp write → backend acknowledgement → final object
  publish → acknowledgement → read-back hash → immutable receipt under its
  content hash → acknowledgement → `ready/<requiredSetDigest>` pointer last →
  acknowledgement. Lookup validates pointer, receipt hash/set digest, and all
  objects. OPFS requires a clean path-specific flush. Page boot threads
  `persistedAfter` into owner bootstrap as a typed fact; owner never infers the
  grant from OPFS or `durable|ephemeral`. Storage class is `opfs-persisted` only
  for OPFS plus `persistedAfter=true`, `opfs-best-effort` for other OPFS, and
  `memory-session` for memory. Playground terminal/status UI renders asset id
  and phase during progress, then storage class on readiness.
  `opfs-best-effort` visibly warns that browser eviction may require refetch;
  `memory-session` visibly warns that assets last only for this session. Neither
  claims browser-eviction resistance. No test or comment calls OPFS rename
  crash-atomic.
- Install emits progress phases
  `cache-check|fetch|verify|persist|ready`. Exit 0 follows the readiness receipt,
  never a background start. `InstallResult.shadowAssets` is discriminated
  `not-required|ready(receipt)` over the extracted `InstallTreeResult`. Asset
  failure after tree completion rejects as structured `ESHADOWASSET` with typed
  `treeResult`, set digest, package/asset, phase, transports, recovery, and typed
  `cause`. Tarball mismatch remains an `EINTEGRITY` cause with dependency-fetch
  fields. Runtime-port reads instead reject `ShadowAssetReadError` with
  `code:'ESHADOWASSETREAD'`; closed/deadline ports are an
  `ESHADOWASSETPORT` cause. The wire carries a safe typed envelope, not a raw
  browser exception. `InstallTreeResult` preserves ADR-0258 dependency
  `provenance`; asset transport stays in receipt/error and never changes lossy
  `InstallResult.source`.
- `PackageAcquisitionAuthority`/`InstallStampAuthority`, not shell, remain the
  tree-claim owners. The adapter turns only typed `ESHADOWASSET` into internal
  `post-tree-failure {treeResult, packageJsonText, lockfileSha256, error}`.
  Authority schedules ordinary background v4 promotion, then rethrows the
  original error. Shell preserves matching package/tree, prints “tree ready,
  asset failed”, and returns 1. Other throws keep pre-tree rollback and
  pending/absent trust; no tree claim attests asset readiness.
- Playground terminal/status UI renders `ESHADOWASSET` with asset, phase, cause
  code, attempted transports, and recovery. Quota failures show used/required
  bytes and a visible, acknowledged “Clear workspace asset cache” action.
- Receipt inspection exposes catalog id/digest, public package/version,
  substitution and adapter ids, source package/version, tarball SRI, member
  path/hash/size, fill transport/cache result, storage class, and canonical
  required-set digest. Store-hit status is ephemeral and does not rewrite an
  immutable receipt under a stable key. Lockfile shape is unchanged.
- Admin inspection reports total/object/retained bytes. Explicit clear waits
  for active manager flights, removes the whole workspace-private asset store,
  acknowledges the backend, then future reads recover as misses. Quota errors
  show usage, required bytes, and this recovery; no path auto-deletes data.
- Pin-only changes flip required-set digest, not `installArtifactIdentity`.
  Per ADR-0249's narrow supersession of ADR-0261, the identity recipe projects
  only tree-affecting overlay/generated-adapter fields. Old objects are retained;
  the new exact set is fetched and receipted.
- `prepareViteEsbuildRuntime` gets `esbuild.wasm` through the manager port; its
  `playground-node-worker-runtime.ts` `?url` import and
  `RIFTY_ESBUILD_WASM_URL` config are deleted. Delivery does not claim esbuild
  API compatibility: the existing generated runtime and parity suite remain the
  adapter proof.

## Observable proof

1. RED: delete the bundle import without the manager; immediate
   `npm i && vite` fails loud. GREEN: install shows asset progress, returns 0
   only after receipt, and the same command succeeds.
2. With `opfs-persisted`, install, confirm owner flush, reload, block network;
   fresh Vite dev/build/preview/optimize actions using esbuild all succeed and
   issue zero asset requests. Repeat with `opfs-best-effort` only while origin
   storage remains; the UI/receipt never calls it durable.
3. Clear only the workspace asset store, retain tarball cache, block network;
   the manager re-extracts, verifies, persists, and all actions succeed with
   zero network.
4. Clear both asset store and matching tarball-cache entry, block network;
   install/action rejects within the ADR-0201 bound with the named asset,
   attempted transports, and recovery.
5. Start install plus two fresh supervised consumers for the same missing
   hash; one owner fill occurs and all callers settle. Kill the owner during
   each phase; callers reject and a replacement owner recovers from only
   verified objects/receipts.
6. Fail asset persist after a fresh tree completes: npm-client rejects with
   `ESHADOWASSET`; the adapter returns `post-tree-failure`; acquisition schedules
   ordinary background v4 promotion; shell exits 1 without rolling back
   `package.json`. A pre-tree failure has no installed outcome and cannot
   publish trusted.
7. Change only the admitted esbuild asset pin; exactly the new required asset
   is fetched, the v4 dependency-tree claim is reused, and the old object remains.
8. Transfer the real 13.3MiB member through the async MessagePort adapter with
   one transferable buffer. Oversize, deadline, cancel, port disposal, and owner
   exit settle every request; no SAB reply or detached retained buffer occurs.
9. With ADR-0266 proof already green, assert the asset owner starts `port1`
   before spawn, supplies `port2` under the stable key, and node bootstrap passes
   its adapter before Vite preparation. Missing capability, spawn failure, child
   kill, and owner dispose settle the asset session within the deadline without
   a Node IPC/env frame.
10. Cold STD resolves the exact source manifest through configured registry,
    rejects name/version/SRI drift, and fetches only its `dist.tarball`; a warm
    tarball-cache hit works offline with zero packument/network calls.
11. The real-browser install ladder commits measured
    `shadowAssetColdFillMs.standard` for `?preset=real-vite&autorun=1`: one
    discarded server/proxy warm-up, then five fresh Chromium contexts. Every run
    proves empty asset store, matching tarball-cache miss, STD fill, one exact
    set digest/receipt, and one storage class. Measure monotonic aggregate
    `cache-check` (immediately before first lookup) through aggregate `ready`
    (after object/receipt/pointer acknowledgement and required flush). Record all
    samples and median/displayMs. Record per-run descriptor
    `memberBytes=13918738` separately from decoded HTTP response-body fields
    `packumentResponseBodyBytes`, `tarballResponseBodyBytes`, and
    `responseBodyBytesTotal` inside the `cache-check`→`ready` window; these are
    post-content-decoding body bytes, not on-wire byte estimates.
    Record `clientCache=cold`, `originCache=warmed-by-discarded-run`, registry
    URL, `--transport` HTTP mode, and per-origin phase-local protocol evidence.
    Missing/duplicate/out-of-order proof, cache hit, non-STD transport, mixed
    storage classes, or fewer than five runs records `unmeasured`; no partial
    median. Dependency-tree install and Vite boot are outside this phase.
    Benchmark artifact schema becomes v3 and always carries the metric;
    unconfigured proxy records `requires proxy`, never omission.
12. Edit, remove, or replace `package-lock.json` under a trusted v4 claim: reuse is
    invalidated before asset planning and normal install runs. Unchanged
    attested bytes reuse the tree and ensure the current pin-only asset set.
13. Exercise fresh install, trusted existing, and snapshot restore with store
    hit/miss/failure. Each path uses the same planner and awaits ensure before
    runtime; post-tree failure preserves independent promotion behavior.
14. Prove physical and identity isolation: guest `readdir/read/rm`, recursive
    `rm('/')`, snapshot, and export cannot observe/delete the sibling store.
    Workspaces `a/b` and `a:b` get distinct guest/private roots; reads, admin
    clear, and lifecycle workspace deletion affect only the exact id. Explicit
    clear/lifecycle deletion removes its sibling while project deletion does not.
15. Missing `InstallOptions.shadowAssets` with an applied asset fails before
    tree publication; the same option omitted for an empty set remains inert.
16. Real Playground terminal/status proof pins asset id and every progress
    phase, ready storage class, both non-persistent warnings, and all structured
    `ESHADOWASSET` fields. A quota fault proves used/required bytes plus visible
    cache-clear acknowledgement; clear success produces a future miss, while
    clear failure stays visible and retains the still-readable store.

## Parity cases

1. Tarball SRI mismatch is `ShadowAssetInstallError.code = ESHADOWASSET` after
   tree completion, with `cause.code = EINTEGRITY` and the same expected/actual,
   package, and version fields as dependency tarballs. The runtime read path
   preserves the same cause under `ESHADOWASSETREAD`.
2. Member hash mismatch after a valid tarball is loud, writes no receipt, and
   does not discard the provenance-valid tarball.
3. Corrupt object is a miss: remove trust, re-extract from valid tarball cache
   before network, verify again, and never retry-spin.
4. Adopted `esbuild-wasm@0.28.0` bytes equal the prior bundled asset: sha256
   `9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b`.

## Fault matrix

| Axis | Fault | Required outcome | Proof |
| --- | --- | --- | --- |
| `torn-state` | Crash at temp, object, receipt, or ready-pointer acknowledgement | Pointer/receipt/object chain must all validate; verified object may be reused; no false success | Fault each boundary, restart owner |
| `corrupt-input` | Duplicate/linked/unsafe/oversize member or corrupt object | Archive rejected before publish; corrupt object demotes to miss | Malicious tar fixtures + byte flip |
| `unbounded-read` | Stalled/oversize response or decompression | Bounded abort/cap error; one configured fallback; no parked caller | Stall and byte-cap injectors |
| `quota-perm-fail` | Private-path persist fails after tree ready | `ESHADOWASSET`; command nonzero; matching package/tree retained; authority schedules independent background promotion; actionable storage error | Path-scoped flush failures + acquisition/shell result |
| `concurrent-same-key` | Install + two children need one hash | One owner fill; every caller settles with the same object result | Barrier transport + call count |
| `provenance-lie` | Cache/transport differs from planned path | Receipt records the path actually used and only after final proof | Force cache hit and each transport |
| `false-fallback` | Object absent/corrupt, valid tarball cached | Offline re-extraction succeeds before network | Clear/flip object, network spy |
| `poisoned-cache` | Pin changes while prior object remains | New digest/object/receipt; old object never satisfies new descriptor | Policy-only pin fixture |
| `torn-state` | Owner dies during ensure/read | MessagePort waiter rejects within bound; replacement validates persisted state before reuse | Kill at each progress phase |
| `false-fallback` | Network down, object and tarball absent | Loud named failure within bound; no retry loop | Clear both caches |
| `concurrent-same-key` | Object deleted mid-session | Same manager single-flights recovery; consumers wait with progress | Delete after initial read |
| `provenance-lie` | OPFS lacks persistent-storage grant | `opfs-best-effort` receipt + warning; no eviction-resistance claim | `persistedAfter=false` browser fixture |
| `provenance-lie` | Memory backend cannot persist | `memory-session` receipt + warning; no reload claim | Memory browser fixture |
| `observable-order` | Tree fails before asset phase vs asset fails after tree | First rolls back/cannot publish trusted; second returns the partial outcome, promotes tree independently, preserves package/tree, exits 1 | Fault both phase boundary sides |
| `observable-order` | Trusted/snapshot tree and immediate Vite action | Owner hook plans and joins ensure before runtime; no fast-path false success | Existing + restore + immediate action |
| `concurrent-same-key` | User clears during active fill/read | Admin clear waits for flights, persists removal, then later read performs one recovery | Barrier fill/read + clear |
| `provenance-lie` / `sibling-drift` | Guest probes private paths or lossy workspace ids collide | Every path stays in exact-id guest/private roots; `a/b` cannot read, clear, or lifecycle-delete `a:b` | Shared isolation suite + recursive root rm + colliding-id admin/deletion test |
| `unbounded-read` | 13.3MiB child read, lost owner reply, cancel | Transferable async response is size-capped/deadlined; dispose/exit/cancel settles waiter | Real MessageChannel browser-unit cases |
| `observable-order` | Asset server starts late, key omitted, or spawn fails | Required runtime fails before preparation; owner peer/session closes; no Node IPC/env fallback | Owner spawn + node-bootstrap order tests (generic transfer: blocker) |
| `provenance-lie` | STD manifest name/version/SRI differs from descriptor | Reject before tarball adoption; no receipt; active registry/auth is used without baked URL | Registry fixture + request spy |
| `provenance-lie` | Trusted v4 claim with missing/edited lockfile, or legacy v3 | Reuse rejected before planner; normal acquisition restores an attested tree/lockfile pair | Delete/byte-edit lockfile + v3 fixture |
| `provenance-lie` | Underlying integrity error crosses install/runtime boundary | Stable outer phase code plus complete typed `EINTEGRITY` cause; no raw DOM error | Direct + MessagePort error-envelope parity |
| `provenance-lie` | Dependency transport and asset fill differ | ADR-0258 tree provenance stays unchanged; receipt/error records actual asset transport; `InstallResult.source` is not relabelled | Mixed cache/STD/Eddy result fixtures |
| `observable-order` | Applied set needs manager but option absent | Named gap before tree publication; empty-set caller remains unaffected | Planner boundary test |

Shared mutable state belongs to the workspace owner. Existing two-tab ownership
is not made safe here; `playground/multi-tab-undefined-behavior` remains the
loud tracked platform gap.

## Out of scope

- Global/profile asset CAS, eager GC, leases, or automatic reclamation.
- Multi-tab workspace ownership.
- Relocating derived esbuild runtime JS out of the app bundle.
- Retiring the alias override (`esbuild-alias-override-retirement`).
- Eddy acceleration (`eddy-batch-asset-closure`).
- Cross-worker `WebAssembly.Module` sharing and automatic pin bumps.
- Sass/SWC/sharp API or lifecycle adaptation.

## Decisions

- Exact applied substitutions, not installed delegates, determine assets.
- One owner manager is the lifecycle authority; paths and transports are
  adapters behind its port.
- Immutable receipt plus ready-pointer-last and read-back verification is the
  trust claim; persistent rename atomicity is not.
- ADR-0266 owns generic capability transfer; this item owns only the asset
  protocol, peer session, and consumer wiring.
- v4 exact-lockfile identity plus the owner acquisition hook closes fresh,
  trusted, and snapshot paths without giving asset readiness to the tree claim.
- Structured partial outcome keeps command success gated on assets while the
  acquisition/stamp authorities attest tree validity independently.
- STD owns the first cold-fill benchmark row; Eddy may only add a matched row.
- Retention is conservative until a real lease/generation design exists.
