# ADR 0249: Owner-managed shadow runtime assets in a workspace-private content store

Status: Accepted
Date: 2026-07

> TL;DR: substitutions declare exact integrity-pinned runtime assets. One
> workspace-owner `ShadowAssetManager` fetches, verifies, persists, and serves
> them through a small port. Install succeeds only after required assets are
> ready; child Workers never own fetch state or read private store paths.

## Context

Two delivery paths disagree today. Install pulls the
`@esbuild/wasi-preview1` alias (~20MB) whose bytes the delegate shadows. The
executed `esbuild.wasm` (13,918,738 bytes / 13.3MiB) instead enters through
`playground-node-worker-runtime.ts` as `esbuild-wasm/esbuild.wasm?url`, then
travels in ADR-0231's `RIFTY_ESBUILD_WASM_URL`: outside npm provenance,
coupled to the app bundle, and not durable when the HTTP cache is evicted.

The first proposal put a CAS at `/.rifty/shadow-assets`, filled it in the
background, and let Vite children lazily fetch misses. That path is not
workspace-local: `ScopedFsSync` deliberately leaves `/.rifty/*` profile-wide.
It also splits one asset lifecycle across install and fresh child Workers and
allows `npm install` to report success before offline-required bytes exist.

## Decision

- Delivery and runtime adaptation are separate contracts. A substitution has
  an exact `assetsByVersion` map. Each descriptor contains logical id, public
  package/version trigger, source package/version/tarball SRI, one normalized
  archive member, member sha256 and byte length, tarball cap, and total
  decompressed cap. An unmapped admitted version throws
  `NotImplementedError('shadow-registry.<name>@<version>.assets')`.
- npm-client exports `createShadowAssetManager`, its store/transport adapters,
  and `ShadowAssetManagerPort`. The workspace owner constructs exactly one after
  backend boot from a construction-local private-store capability, configured
  transports/learned pins, actual backend, and the separately threaded browser
  persistence grant; it injects the port into shell install and child adapters.
  `InstallOptions.shadowAssets` is optional only for callers whose applied
  required set is empty. A non-empty set without it throws
  `NotImplementedError('npm.install.shadowAssets')` before link/shim/lockfile
  mutation. SDK/tests may inject the real manager over an in-memory store.
- The owner-resident `ShadowAssetManager` deep module owns registry clients,
  Eddy configuration and learned pins, single-flight, verification, publish,
  durability, receipts, retention, and recovery. Its port exposes only
  `ensure(required)`, `readVerified(asset)`, and `inspectReceipt(setDigest)`.
  Install calls it in-owner. Children never know store paths and never own
  network recovery state. A separate owner-admin port exposes `inspectUsage()` and explicit
  `clearWorkspaceCache()` to the playground UI.
- Supervised children use a dedicated async MessagePort adapter, never the
  1MiB SAB sync-RPC. Frames carry request id and
  `read|progress|result|error|cancel`; result transfers a response-owned
  `ArrayBuffer` bounded by descriptor size. Client deadline, port disposal, and
  owner exit reject every waiter; cancel detaches one caller without aborting a
  shared flight still in use.
- npm-client exports
  `SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1'`. After
  planning the supervised consumer's exact set, the owner creates one
  `MessageChannel` for a non-empty set and starts the manager server on `port1`
  before spawn. Generic `SpawnWorkerSpec.capabilityPorts` carries `port2` under
  that key through ADR-0266's opaque transfer/publication seam.
  `node-entry-bootstrap` reads the named port and passes its adapter through
  `prepareViteCli` before any Vite import. The asset is removed from
  `NodeWorkerRuntimeConfig` and `RIFTY_ESBUILD_WASM_URL`; it is never exposed on
  Node `process`, multiplexed over guest Node IPC, or encoded in env. Missing
  capability for a non-empty Vite runtime set throws
  `NotImplementedError('vite.esbuild.shadowAssets')`. Owner attaches idempotent
  session cleanup to child exit before returning its handle. Spawn failure
  closes both ends; exit/kill closes the owner session without aborting shared
  flights. Child `dispose()` rejects local requests, best-effort cancels, then
  closes. Graceful manager shutdown sends terminal error then closes; abrupt
  owner death is bounded by the client deadline. `serve:true` termination relies
  on the already-attached owner cleanup because the realm is terminated directly.
- Before `ScopedFsSync` is installed, one workspace-storage composition root
  closes over the unscoped backend. It validates an exact, non-empty,
  well-formed `workspaceId`, then derives one injective `workspaceStorageKey`:
  canonical `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` ids remain byte-identical;
  every other admitted id is `~` plus unpadded base64url of its exact UTF-8
  bytes. Both the guest prefix and private root use this key; lossy replacement
  with `_` is forbidden. The root returns only the guest-scoped VFS plus a
  workspace-private store capability rooted at
  `/.rifty-private/workspaces/<workspaceStorageKey>/shadow-assets/v1/{objects,receipts,ready,tmp}`.
  Raw storage never escapes that closure or the ordinary `OwnerVfsAuthority`.
  The private root is a raw-root sibling of `<workspaceVfsPrefix>`, not its
  descendant, so scoped guest paths and ancestor operations cannot reach it.
  Snapshots and exports walk only the guest root. Explicit workspace-cache
  clear removes the private sibling; lifecycle deletion of the durable
  workspace removes both siblings. Project deletion retains workspace-shared
  assets. Logical `/.rifty/*` is forbidden because it is profile-wide.
- `install()` derives the exact required set from substitutions actually
  applied. It awaits `ensure`; exit 0 means every required object is verified
  and the set receipt has the backend's readiness acknowledgement. OPFS also
  requires a clean flush for all private asset paths. Page boot threads
  `persistedAfter` as a typed owner-bootstrap fact; owner must not infer it from
  OPFS or its `durable|ephemeral` receipt. Storage class is `opfs-persisted`
  only for actual OPFS plus `persistedAfter=true`, `opfs-best-effort` for OPFS
  without the grant, and `memory-session` for memory. The latter two warn.
  Only `opfs-persisted` claims browser-eviction resistance; best-effort reload
  proof is conditional on origin storage still existing, and memory claims no
  reload survival.
- Install has two observable phases: dependency tree, then shadow assets. On
  success `InstallResult.shadowAssets` is
  `{status:'not-required'} | {status:'ready', receipt}`. Existing tree fields
  form `InstallTreeResult`, including ADR-0258's dependency-only acquisition
  `provenance`. Asset transport/cache facts live only in the asset receipt/error;
  they do not change the compatibility projection `InstallResult.source`.
  Post-tree asset failure rejects with
  `ShadowAssetInstallError {code:'ESHADOWASSET', treeResult:
  InstallTreeResult, requiredSetDigest, asset, phase, transports, recovery,
  cause}`. `cause` preserves the typed underlying failure; tarball mismatch is
  `EINTEGRITY` with the dependency-fetch fields. Runtime reads use
  `ShadowAssetReadError {code:'ESHADOWASSETREAD', asset, phase, recovery,
  cause}`. MessagePort serializes that safe error envelope and reconstructs the
  typed error; transport close/deadline is an `ESHADOWASSETPORT` cause, never an
  untyped `DOMException`.
  Direct callers still see failure; the structured tree result proves which
  phase completed.
- ADR-0261's `PackageAcquisitionAuthority` and `InstallStampAuthority` remain
  the sole tree-claim owners; shell is presentation only. The Playground install
  adapter converts only typed `ESHADOWASSET` into an internal
  `post-tree-failure` outcome carrying `treeResult`, exact post-install
  `package.json`, exact lockfile digest, and the original error. Acquisition
  schedules ordinary background promotion from those tree facts, then rethrows
  the original asset error. Shell keeps matching package/tree, prints “tree
  ready, asset failed”, and returns nonzero. Pre-tree throws keep existing
  package rollback and pending/absent claim behavior. Tree promotion never
  attests asset readiness; its refusal never becomes asset success.
- Dependency-tree identity and asset-set identity are independent. One pure
  pre-mutation planner derives `AppliedSubstitution[]` from exact resolved
  versions during install or from a lockfile whose exact bytes are attested by
  the trusted tree claim. `InstallStamp.version:4` retains ADR-0261's root,
  slug, exact package text, artifact identity, deps, packages, and durability
  fields and adds
  `lockfileSha256`, lowercase hex sha256 of the exact stored
  `package-lock.json` bytes. Fresh-install and snapshot-plan outcomes carry the
  digest into promotion; the authority re-reads/hashes in its final commit slot.
  Trusted checks re-read/hash before returning `existing`. Missing/mismatched
  lockfile bytes or a v1-v3 claim are misses and run normal acquisition; the
  planner never trusts an edited guest lockfile.
- Fresh install runs planner/ensure inside npm-client. Before returning a
  trusted `existing` tree, and after applying a verified snapshot before
  returning `snapshot`, `PackageAcquisitionAuthority` invokes one injected
  owner asset hook using the same planner and manager. Snapshot/fresh outcomes
  both carry the exact digest required for v4 promotion. Post-tree hook failure
  still allows independent tree promotion, then fails the acquisition loudly.
  Every successful arrival path ensures assets before runtime; no fast path
  bypasses the manager. Planner validates descriptors and manager availability
  before a fresh tree publishes.
  A pin-only change flips the canonical asset-set digest, not
  `installArtifactIdentity`; the recipe projects only tree-affecting overlay
  and generated-adapter fields. An explicit `npm install` may still run normal
  npm tree reconciliation; this ADR does not promise an asset-only command.
- A miss uses Eddy when configured, otherwise the standard-registry adapter.
  Both flow through the existing bounded tarball chokepoint. STD first looks up
  the tarball cache by declared source name/version/SRI. On miss it resolves the
  exact source package through the injected registry client and active
  registry/auth configuration, requires the manifest name/version and
  `dist.integrity` to equal the descriptor, then passes `dist.tarball` as
  `resolved` plus the declared integrity to `fetchAndUnpackToCache`. Missing or
  mismatched manifest provenance fails before tarball adoption; no URL is baked
  into the catalog. A valid tarball-cache hit performs no packument request.
  Eddy
  requests only the canonical de-duplicated source packages for currently
  missing applied assets; its learned pin is keyed by that exact request.
  Bounded Eddy failure falls back to the standard registry. Store hits call
  neither transport.
- Asset source package/version must not match any composed shadow trigger or
  baked override. Registry construction rejects such a descriptor as
  `ESHADOWASSETSOURCE`; this keeps Eddy's ordinary install resolver from
  substituting the pinned source. Raw-source Eddy resolution is a future
  protocol decision, not a silent fallback.
- Adoption accepts exactly one matching regular-file member. It rejects
  missing or duplicate matches, links, absolute/traversal/non-normalized paths,
  declared-size mismatch, tarball SRI mismatch, member sha256 mismatch, and
  either size-cap breach. Both integrity gates are required on every transport.
- Publish is verified, not assumed atomic: unique temp write, backend
  acknowledgement, final object publish, acknowledgement, read-back hash,
  immutable provenance receipt under its own content hash, then the
  `ready/<requiredSetDigest>` pointer written last and acknowledged.
  Correctness does not rely on `renameSync` being crash-atomic in OPFS. Every
  lookup validates pointer, receipt hash/set digest, and objects; any torn or
  corrupt part is a miss tried from valid cached tarballs before network.
- A receipt records catalog id/digest, public package/version, substitution and
  runtime-adapter ids, source package/version, tarball SRI, member
  path/hash/size, fill transport/cache result, storage class, and required-set
  digest. A store-hit ensure returns that immutable receipt plus ephemeral
  hit/progress state; it never rewrites provenance under a stable key. The same
  facts drive terminal progress and named recovery errors.
- No eager sweep runs on ensure, pin update, or app update. Objects and orphan
  temps remain until explicit admin clear or durable workspace-root removal;
  project deletion retains them. Clear waits for active manager flights,
  removes the private store, acknowledges the backend, then makes future reads
  recover as misses. Quota errors report usage and the explicit recovery; they
  never auto-delete. A shared/profile CAS or automatic GC requires a separate
  lease and generation contract.
- Snapshot restore and first use join the same owner flight and wait with
  visible progress. There is no fire-and-forget success path. Multiple browser
  tabs remain the existing explicitly tracked
  `playground/multi-tab-undefined-behavior` gap; this ADR claims one authority
  only within a workspace owner.
- Removing heavy bytes from the app bundle changes the delivery plane only.
  Every package still needs a package-specific, parity-proven runtime adapter
  implementing its real API, process, and teardown behavior. A data catalog
  cannot install executable lifecycle hooks.

This ADR supersedes ADR-0231 only for the esbuild asset-URL bootstrap clause:
kernel/node/SQLite host config stands, while `RIFTY_ESBUILD_WASM_URL` is removed.
It supersedes ADR-0261 only for install-claim version/schema and artifact-policy
projection: v4 adds exact lockfile identity, and asset-only policy fields no
longer invalidate the dependency tree. ADR-0261's owner, root binding,
non-transferability, promotion, and durability rules stand.

## Consequences

- Executed bytes have npm provenance, bounded extraction, auditable receipts,
  and storage-qualified offline readiness. Install and runtime show one progress/error
  vocabulary.
- `esbuild.wasm` can leave the playground asset bundle; derived runtime JS
  remains bundled. Admitting more versions adds heavy store bytes, not app
  asset bytes.
- The manager is a deep module: transport, concurrency, recovery, and VFS
  durability stay behind one testable port. Async MessagePort and in-memory test
  adapters share the same contract.
- npm-client's public result/error surface gains the readiness receipt and
  structured `ESHADOWASSET`; embedders cannot mistake a ready tree for command
  success and can preserve tree state without parsing terminal text.
- Workspace isolation duplicates assets and retention is conservative. Both
  are preferred to cross-workspace authority or unsafe reclamation.
- Generated canonical workspace ids retain their existing roots. A legacy
  non-canonical lossy-slug root is never adopted because its owner is
  ambiguous; the exact id opens its injective root.
- Asset readiness can fail after a valid dependency tree exists. The command
  reports failure while preserving independently attestable tree state; direct
  callers can distinguish tree failure from post-tree asset failure.
- Cold standard installs add a serial post-tree asset-fill phase before exit 0.
  The admitted esbuild member is 13,918,738 bytes; this is extracted member
  size, not transferred tarball size. Fetch is byte-capped and
  no-progress-bounded, not total-time-bounded. This ADR quotes no seconds; the
  store item records real-browser STD wall time and decoded packument/tarball
  response-body bytes, and the Eddy item later adds the matched row.
- Existing v3 install claims miss once so v4 can attest exact lockfile bytes.
- This does not generalize ABI/API adaptation for Sass, SWC, sharp, or future
  binary-backed packages; each remains a separate parity decision.
