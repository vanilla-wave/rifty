---
area: npm-client
status: ready
title: Owner-managed shadow assets — exact set, verified readiness, workspace-private store
created: 2026-07-13
why: executed esbuild.wasm ships outside npm provenance; the first CAS proposal also returned install success before readiness and put workspace data in profile-wide /.rifty
user_story: As a Vite user, I want npm install to make the exact esbuild runtime bytes honestly ready for offline use, with visible provenance and recovery
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/playground/0241-install-artifact-identity-for-dependency-trees.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/backlog/playground/multi-tab-undefined-behavior.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/index.ts, packages/npm-client/src/fetch-and-unpack.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/shadow-shims.ts, packages/kernel/src/spawn-worker.ts, packages/kernel/src/worker-entry.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/process-manager.ts, packages/runtime-js/src/ipc/install-process.ts, tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, apps/playground/src/App.tsx, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/glue/install-stamp.ts, apps/playground/src/glue/scoped-vfs.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-node-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/vite-esbuild-runtime.ts, tools/shadow-registry/src/install-artifact-recipe.ts]
---

## Context

ADR-0249 records the recut decision. Today `vite-esbuild-runtime.ts` imports
`esbuild-wasm/esbuild.wasm?url`; the registry cannot declare runtime assets;
there is no owner-level asset authority. Logical `/.rifty/*` is profile-wide,
not workspace-local (`scoped-vfs.ts`).

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
  stamp. Bump to `InstallStamp.version:3` with `lockfileSha256`, lowercase hex
  sha256 of the exact stored `package-lock.json` bytes. Reuse re-hashes those
  bytes; v2, missing, or mismatched bytes invalidate the stamp and run normal
  install. Snapshot restore uses the same gate. It
  validates descriptors and manager availability before tree publication; every
  reuse awaits current asset ensure. No unattested guest lockfile, app-global
  catalog, or semver-range inference participates. Repeated explicit `npm
  install` keeps normal npm reconciliation; no asset-only command fast path is
  promised.
- Across composed catalogs and baked overrides, an asset source package/version
  cannot match a substitution trigger. Construction rejects it as
  `ESHADOWASSETSOURCE`; Eddy raw-source resolution is not implied.
- npm-client exports `createShadowAssetManager` and its port/adapter types. The
  workspace owner constructs one after backend boot and injects it through
  `InstallOptions.shadowAssets`. Omission is valid only for an empty required
  set; otherwise planner throws
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
  `port2` under that key in generic `SpawnWorkerSpec.capabilityPorts`. Kernel is
  protocol-agnostic: normalize absent to `{}`, reject empty names or a reused
  port, include every port exactly once in the init transfer list, preserve the
  record in `WorkerSpawnSpec`, and publish it in `KernelProcessSpec` before
  pre-entry/import. `node-entry-bootstrap` reads the key and explicitly passes
  the adapter through `prepareViteCli` to `prepareViteEsbuildRuntime`; it is not
  exposed on Node `process`, Node IPC, or env. A required runtime without it
  loud-throws `NotImplementedError('vite.esbuild.shadowAssets')`. Owner attaches
  idempotent session cleanup to child exit before returning its handle. Spawn
  failure closes both ends; exit/kill disposes the owner session without
  aborting shared flights. Child dispose rejects local requests, best-effort
  cancels, then closes; normal/setup-failure finalization closes child capability
  ports. Graceful manager shutdown sends terminal error then closes; abrupt
  owner death remains bounded by the client deadline. `serve:true` termination
  relies on the already-attached owner cleanup.
- The raw owner-VFS adapter roots data at
  `/.rifty-private/workspaces/<workspaceSlug>/shadow-assets/v1/{objects,receipts,ready,tmp}`,
  a sibling of the guest workspace root. Guest reads/readdir/rm (including
  `/`), snapshots, exports, and logical `/.rifty` cannot reach it. Explicit
  workspace-cache clear removes the private sibling; any durable workspace-root
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
  objects. OPFS requires a clean path-specific flush. Storage class is
  `opfs-persisted` only with boot `persistedAfter=true`, otherwise
  `opfs-best-effort`; memory is `memory-session`. Best-effort and memory warn;
  neither claims browser-eviction resistance. No test or comment calls OPFS
  rename crash-atomic.
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
  browser exception.
- The playground shell is the only tree-stamp writer. It schedules the existing
  tree drain/stamp from either normal result or `ESHADOWASSET.treeResult` before
  returning 0/1; the stamp never attests asset readiness. On asset failure it
  keeps the matching `package.json` and prints “tree ready, asset failed”. A
  pre-tree failure rolls back `package.json`, leaves the demoted stamp pending,
  and never re-promotes prior trust after the failed mutation attempt.
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
  Overlay/generated-adapter changes still flip tree identity. Old objects are
  retained; the new exact set is fetched and receipted.
- `prepareViteEsbuildRuntime` gets `esbuild.wasm` through the manager port; its
  `?url` import is deleted. Delivery does not claim esbuild API compatibility:
  the existing generated runtime and parity suite remain the adapter proof.

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
   `ESHADOWASSET`, shell exits 1 without rolling back `package.json`, and the
   independent tree stamp may become trusted only after its normal clean
   drain. A failure before tree completion produces no trusted stamp.
7. Change only the admitted esbuild asset pin; exactly the new required asset
   is fetched, the dependency-tree stamp is reused, and the old object remains.
8. Transfer the real 13.3MiB member through the async MessagePort adapter with
   one transferable buffer. Oversize, deadline, cancel, port disposal, and owner
   exit settle every request; no SAB reply or detached retained buffer occurs.
9. Assert the owner starts `port1` before spawn, kernel transfers the named
   `port2` exactly once in the init list, and node bootstrap reads the published
   capability before Vite preparation.
   Missing capability, failed init, child kill, and owner dispose all reject
   within the deadline without a Node IPC frame.
10. Cold STD resolves the exact source manifest through configured registry,
    rejects name/version/SRI drift, and fetches only its `dist.tarball`; a warm
    tarball-cache hit works offline with zero packument/network calls.
11. Edit, remove, or replace `package-lock.json` under a trusted stamp: reuse is
    invalidated before asset planning and normal install runs. Unchanged
    attested bytes reuse the tree and ensure the current pin-only asset set.
12. Prove physical isolation: guest `readdir/read/rm`, recursive `rm('/')`,
   snapshot, and export cannot observe/delete the sibling store; explicit cache
   clear/lifecycle root deletion removes it while project deletion does not.
13. Missing `InstallOptions.shadowAssets` with an applied asset fails before
    tree publication; the same option omitted for an empty set remains inert.

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
| `quota-perm-fail` | Private-path persist fails after tree ready | `ESHADOWASSET`; command nonzero; matching package/tree retained; independent stamp follows its own drain; actionable storage error | Path-scoped flush failures + shell result |
| `concurrent-same-key` | Install + two children need one hash | One owner fill; every caller settles with the same object result | Barrier transport + call count |
| `provenance-lie` | Cache/transport differs from planned path | Receipt records the path actually used and only after final proof | Force cache hit and each transport |
| `false-fallback` | Object absent/corrupt, valid tarball cached | Offline re-extraction succeeds before network | Clear/flip object, network spy |
| `poisoned-cache` | Pin changes while prior object remains | New digest/object/receipt; old object never satisfies new descriptor | Policy-only pin fixture |
| `torn-state` | Owner dies during ensure/read | MessagePort waiter rejects within bound; replacement validates persisted state before reuse | Kill at each progress phase |
| `false-fallback` | Network down, object and tarball absent | Loud named failure within bound; no retry loop | Clear both caches |
| `concurrent-same-key` | Object deleted mid-session | Same manager single-flights recovery; consumers wait with progress | Delete after initial read |
| `provenance-lie` | OPFS lacks persistent-storage grant | `opfs-best-effort` receipt + warning; no eviction-resistance claim | `persistedAfter=false` browser fixture |
| `provenance-lie` | Memory backend cannot persist | `memory-session` receipt + warning; no reload claim | Memory browser fixture |
| `observable-order` | Tree fails before asset phase vs asset fails after tree | First rolls back/never stamps; second preserves package/tree, exposes `treeResult`, stamps independently, exits 1 | Fault both phase boundary sides |
| `observable-order` | Snapshot restore and immediate Vite action | Consumer joins ensure before runtime start; no background false success | Restore + immediate action |
| `concurrent-same-key` | User clears during active fill/read | Admin clear waits for flights, persists removal, then later read performs one recovery | Barrier fill/read + clear |
| `provenance-lie` / `sibling-drift` | Guest probes or deletes private paths | Every sync/async/RPC/archive path is contained to guest root; only owner adapter reaches sibling | Shared isolation suite + recursive root rm |
| `unbounded-read` | 13.3MiB child read, lost owner reply, cancel | Transferable async response is size-capped/deadlined; dispose/exit/cancel settles waiter | Real MessageChannel browser-unit cases |
| `observable-order` | Capability port omitted, transferred late, or init transfer fails | Required runtime fails before preparation; port is published from init before pre-entry; both endpoints close | Kernel init transfer-list + node-bootstrap order tests |
| `provenance-lie` | STD manifest name/version/SRI differs from descriptor | Reject before tarball adoption; no receipt; active registry/auth is used without baked URL | Registry fixture + request spy |
| `provenance-lie` | Trusted stamp with missing/edited lockfile | Reuse rejected before planner; normal install restores an attested tree/lockfile pair | Delete/byte-edit lockfile under valid stamp |
| `provenance-lie` | Underlying integrity error crosses install/runtime boundary | Stable outer phase code plus complete typed `EINTEGRITY` cause; no raw DOM error | Direct + MessagePort error-envelope parity |
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
- Structured two-phase outcome keeps command success gated on assets while the
  shell's existing authority attests tree validity independently.
- Retention is conservative until a real lease/generation design exists.
