---
area: npm-client
status: ready
title: ShadowAssetManager — verified store, STD transport, receipts, install outcome
created: 2026-07-15
why: an exact plan is not runtime readiness until one authority fetches, verifies, publishes, and reports the bytes without assuming a physical VFS layout
user_story: As an npm-client consumer, I want install success to mean every planned runtime asset is verified and ready through a storage-qualified receipt
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-catalog-plan]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/npm-client/0258-structured-install-acquisition-provenance.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/index.ts, packages/npm-client/src/fetch-and-unpack.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/registry.ts]
---

## Context

This is the deep, realm-local module. Its storage interface uses semantic
entries rather than paths, so Memory VFS now and the future Workbench-private
adapter exercise the same manager without exposing `workspaceId`, project
roots, or owner protocols.

## Public interface

~~~ts
const SHADOW_ASSET_MAX_READ_DEADLINE_MS = 30_000

type ShadowAssetStorageClass =
  | 'opfs-persisted'
  | 'opfs-best-effort'
  | 'memory-session'

type ShadowAssetStorageEntry =
  | Readonly<{ kind: 'temp'; id: string }>
  | Readonly<{ kind: 'object'; sha256: string }>
  | Readonly<{ kind: 'receipt'; sha256: string }>
  | Readonly<{ kind: 'ready'; requiredSetDigest: string }>

interface ShadowAssetStorageSnapshot {
  readonly entryCount: number
  readonly storedBytes: number
  readonly entries: readonly Readonly<{
    entry: ShadowAssetStorageEntry
    byteLength: number
  }>[]
}

interface ShadowAssetStorage {
  readonly storageClass: ShadowAssetStorageClass
  read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null>
  write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void>
  remove(entry: ShadowAssetStorageEntry): Promise<void>
  inspect(): Promise<ShadowAssetStorageSnapshot>
  clear(): Promise<void>
  close(): Promise<void>
}

interface ShadowAssetSourceRequest {
  readonly name: string
  readonly version: string
  readonly integrity: string
  readonly maxTarballBytes: number
}

interface ShadowAssetSourceResult {
  readonly request: ShadowAssetSourceRequest
  readonly bytes: Uint8Array
  readonly fillTransport: 'standard' | 'eddy'
  readonly fillCache: 'tarball' | 'network' | 'bundle'
}

interface ShadowAssetSource {
  acquire(
    requests: readonly ShadowAssetSourceRequest[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly ShadowAssetSourceResult[]>
  close(): Promise<void>
}

type ShadowAssetProgress =
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
      storageClass: ShadowAssetStorageClass
    }>

interface ShadowAssetEnsureOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ShadowAssetProgress) => void
}

interface ShadowAssetReadOptions extends ShadowAssetEnsureOptions {
  readonly deadlineMs?: number
}

type ShadowAssetFailurePhase =
  | 'cache-check'
  | 'fetch'
  | 'verify'
  | 'persist'
  | 'ready'

interface ShadowAssetTransportFailure {
  readonly transport: 'standard' | 'eddy'
  readonly message: string
}

interface ShadowAssetFailure {
  readonly message: string
  readonly requiredSetDigest: string
  readonly assetId?: string
  readonly phase: ShadowAssetFailurePhase
  readonly transports: readonly ShadowAssetTransportFailure[]
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly usedBytes?: number
  readonly requiredBytes?: number
  readonly cause?: unknown
}

class ShadowAssetError extends Error {
  readonly code: 'ESHADOWASSET'
  readonly requiredSetDigest: string
  readonly assetId?: string
  readonly phase: ShadowAssetFailurePhase
  readonly transports: readonly ShadowAssetTransportFailure[]
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly usedBytes?: number
  readonly requiredBytes?: number
  readonly cause?: unknown
  constructor(failure: ShadowAssetFailure)
}

class ShadowAssetInstallError extends ShadowAssetError {
  readonly treeResult: InstallTreeResult
  readonly plan: ShadowAssetPlan
  constructor(
    treeResult: InstallTreeResult,
    plan: ShadowAssetPlan,
    failure: ShadowAssetFailure,
  )
}

type ShadowAssetReadFailureReason = 'unknown-asset' | 'deadline'

interface ShadowAssetReadFailure {
  readonly message: string
  readonly assetId: string
  readonly reason: ShadowAssetReadFailureReason
  readonly deadlineMs?: number
  readonly cause?: unknown
}

class ShadowAssetReadError extends Error {
  readonly code: 'ESHADOWASSETREAD'
  readonly assetId: string
  readonly reason: ShadowAssetReadFailureReason
  readonly deadlineMs?: number
  readonly cause?: unknown
  constructor(failure: ShadowAssetReadFailure)
}

interface ShadowAssetStoreFailure {
  readonly message: string
  readonly phase: 'inspect' | 'clear' | 'close'
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly usedBytes?: number
  readonly requiredBytes?: number
  readonly cause?: unknown
}

class ShadowAssetStoreError extends Error {
  readonly code: 'ESHADOWASSETSTORE'
  readonly phase: 'inspect' | 'clear' | 'close'
  readonly recovery: 'retry' | 'clear-and-retry' | 'none'
  readonly usedBytes?: number
  readonly requiredBytes?: number
  readonly cause?: unknown
  constructor(failure: ShadowAssetStoreFailure)
}

interface ShadowAssetReadyReceipt {
  readonly schema: 1
  readonly receiptSha256: string
  readonly requiredSetDigest: string
  readonly catalog: Readonly<{ id: string; digest: string }>
  readonly storageClass: ShadowAssetStorageClass
  readonly substitutions: ShadowAssetPlan['substitutions']
  readonly assets: readonly Readonly<{
    id: string
    source: Readonly<{ name: string; version: string; integrity: string }>
    member: string
    memberSha256: string
    memberSize: number
    fillTransport: 'standard' | 'eddy'
    fillCache: 'tarball' | 'network' | 'bundle'
  }>[]
}

type ShadowAssetEnsureResult =
  | Readonly<{ kind: 'not-required'; plan: ShadowAssetPlan }>
  | Readonly<{
      kind: 'ready'
      plan: ShadowAssetPlan
      receipt: ShadowAssetReadyReceipt
    }>

interface ShadowAssetInstaller {
  ensure(
    plan: ShadowAssetPlan,
    options?: ShadowAssetEnsureOptions,
  ): Promise<ShadowAssetEnsureResult>
  inspectReceipt(
    requiredSetDigest: string,
  ): Promise<ShadowAssetReadyReceipt | null>
}

interface ShadowAssetRuntimeReader {
  readVerified(
    assetId: string,
    options?: ShadowAssetReadOptions,
  ): Promise<Uint8Array>
}

interface ShadowAssetUsage {
  readonly storageClass: ShadowAssetStorageClass
  readonly entryCount: number
  readonly storedBytes: number
  readonly verifiedObjectCount: number
  readonly verifiedObjectBytes: number
  readonly readySetCount: number
}

interface ShadowAssetAdmin {
  inspectUsage(): Promise<ShadowAssetUsage>
  clearCache(): Promise<ShadowAssetUsage>
}

interface ShadowAssetManager {
  readonly installer: ShadowAssetInstaller
  readonly admin: ShadowAssetAdmin
  runtimeReader(plan: ShadowAssetPlan): ShadowAssetRuntimeReader
  close(): Promise<void>
}

declare function createMemoryShadowAssetStorage(): ShadowAssetStorage
declare function createStandardShadowAssetSource(options: Readonly<{
  registry: RegistryClient
  tarballCache: TarballCache
}>): ShadowAssetSource
declare function createShadowAssetManager(options: Readonly<{
  storage: ShadowAssetStorage
  source: ShadowAssetSource
}>): ShadowAssetManager
~~~

Receipt payload bytes are UTF-8 of its exact object above with
`receiptSha256` omitted, encoded by package-private canonical JSON: plain objects
only, keys sorted by UTF-16 code-unit order, arrays retained, no whitespace,
strings/booleans/null encoded as `JSON.stringify`, and only non-negative safe
integer numbers (no `-0`). `receiptSha256` is 64 lowercase hex over those bytes.
The stored ready pointer is canonical UTF-8 JSON exactly
`{schema:1,requiredSetDigest,receiptSha256}`; temp/object values are raw bytes.
Decoders reject extra/missing/accessor/symbol keys, wrong prototypes, duplicate
semantic ids, or non-canonical bytes. All digest/hash inputs validate as 64
lowercase hex; source integrity
validates with npm-client's existing SRI parser. Read `deadlineMs` is a positive
safe integer no greater than the exported 30,000 ms maximum; omission uses that
maximum. Ensure has no
total deadline: its source uses the injected RegistryClient's ADR-0201
no-progress bounds, so a large slow-but-progressing tarball is not aborted.
Storage mutation/clear promises are
the adapter acknowledgement: they resolve only after their semantic scope is
durable enough for `storageClass`. `inspect().entryCount/storedBytes` include
undecodable physical entries; `entries` contains only decoded semantic keys.
Every storage read returns owned bytes and every write snapshots its input.
All exported error constructors require their exact failure object above,
validate it, set the corresponding class name, and snapshot/freeze arrays and
data fields. `ShadowAssetInstallError` additionally requires the exact tree
result and plan; no overload or positional message/cause shorthand exists.
`ShadowAssetReadFailure.deadlineMs` is required exactly for `reason:'deadline'`
and forbidden for `reason:'unknown-asset'`.

`InstallOptions.shadowAssets?` is exactly
`{installer: ShadowAssetInstaller, options?: ShadowAssetEnsureOptions}`;
`install()` passes those operation-local signal/progress options to
`ensure`. `InstallOptions.onTreeMutationStart?(): void` is an authority barrier,
not an observer: call it exactly once after all preflight/resolve/fetch/plan/path
validation and immediately before `link` can first mutate the tree. A throw
aborts with zero tree mutation. For a non-empty plan
`InstallResult.shadowAssets` is required and exactly the `kind:'ready'` branch
of `ShadowAssetEnsureResult`. Empty-plan install neither calls the group nor
adds the property, preserving the existing result shape; absence is the exact
empty-plan signal. Thus an install authority receives the applied exact
non-empty plan on success or typed post-tree asset failure without reconstructing
it. No caller receives manager/admin/source.

## Acceptance

- npm-client exports exactly the interfaces/factories above plus catalog plan
  descriptor types, and two real adapters: storage
  backed by `MemoryVfs` for tests/SDK use and the STD registry source using the
  injected `RegistryClient` plus existing tarball cache.
- Storage is path-neutral:
  `ShadowAssetStorageEntry` is exactly
  `temp(id)|object(sha256)|receipt(sha256)|ready(requiredSetDigest)`.
  `ShadowAssetStorage` exposes only the methods above. The adapter owns path
  mapping and acknowledgement; manager code never constructs a VFS path.
- `ShadowAssetManager` owns descriptor validation, per-hash single-flight,
  learned state needed by transports, hit re-verification, bounded fetch,
  exact-member extraction, publish/receipt ordering, recovery, and shutdown.
  `ShadowAssetInstaller` exposes only ensure/receipt inspection to acquisition.
  `runtimeReader(plan)` binds reads to one validated exact plan;
  `ShadowAssetRuntimeReader` exposes only `readVerified(assetId, options?)`;
  every direct read uses the fixed public ceiling and callbacks/signals remain
  realm-local. An id absent from the bound plan throws
  `ShadowAssetReadError {reason:'unknown-asset'}`. Deadline expiry removes only
  that waiter and throws
  `ShadowAssetReadError {reason:'deadline',deadlineMs}`; verified
  acquisition/read failures throw `ShadowAssetError`.
  A runtime read verifies an existing object or joins an already-admitted ensure
  flight; it never starts source/network acquisition. Missing/corrupt state with
  no flight fails with explicit retry/clear recovery. Workbench admits children
  only after ensure, so the read deadline bounds local authority/port loss, not
  a progressing fetch.
  `ShadowAssetAdmin` exposes `inspectUsage()` and `clearCache()`; manager
  lifecycle alone exposes `close()`. Children never receive installer, admin,
  or manager lifecycle authority.
- A hit re-hashes the object. A miss tries a valid SRI-keyed tarball-cache
  entry, otherwise resolves exact source name/version through the injected
  registry/auth configuration, requires manifest name/version and
  `dist.integrity` equality, then uses the bounded fetch chokepoint. No catalog
  stores a registry URL.
- Source requests are sorted/de-duplicated by exact
  `{name,version,integrity,maxTarballBytes}`. The manager requires exactly one
  owned result per request and rejects missing, duplicate, extra, mismatched, or
  oversize results before extraction. The standard adapter checks tarball cache
  first, then exact registry manifest/SRI and the bounded fetch chokepoint; it
  emits only `standard/tarball` or `standard/network` facts. Eddy values in the
  closed result union are reserved for its blocked adapter item.
- Exact-member extraction accepts one matching regular file. It rejects
  missing/duplicate matches, links, absolute/traversal/non-normal paths,
  truncated archives, SRI/hash/declared-size mismatch, and either cap breach.
  It must not reuse the current last-member-wins whole-archive helper.
- Publish order is unique temp write → acknowledgement → final object →
  acknowledgement → read-back hash → immutable receipt →
  acknowledgement → `ready/<requiredSetDigest>` pointer last →
  acknowledgement. Lookup validates pointer, receipt digest/set, and every
  object. No correctness claim relies on OPFS rename atomicity.
- Receipt records catalog id/digest, exact plan substitutions including public
  package/version and substitution/runtime-adapter ids, source
  package/version/tarball SRI, member path/hash/size,
  fill transport/cache result, storage class, and required-set digest. A hit
  does not rewrite immutable provenance.
- `ensure` emits `cache-check|fetch|verify|persist|ready`; observer failure
  does not affect acquisition. One waiter cancellation does not abort a shared
  flight needed by another.
- `install()` validates the plan and injected installer before link/shim/lockfile mutation,
  builds `InstallTreeResult`, then starts and awaits `ensure`. A non-empty plan
  without an injected installer loud-throws
  `NotImplementedError('npm.install.shadowAssets')`. Empty plans preserve
  existing behavior.
- `onTreeMutationStart` fires once before the first possible `link` write for
  empty and non-empty asset plans. It does not fire for validation/resolution/
  fetch failure or a proven no-mutation fast path. `shadowAssets.options` is the
  only route by which a generic-open observer, terminal observer, or cancellation
  reaches install-owned ensure; callbacks/signals are never retained
  after that ensure settles.
- Tree success is `InstallTreeResult`; a non-empty plan adds
  `shadowAssets: ready(plan,receipt)`. Post-tree asset failure throws
  typed `ShadowAssetInstallError {code:'ESHADOWASSET', treeResult, plan,
  requiredSetDigest, assetId, phase, transports, recovery, cause}`. Dependency
  provenance/source remains tree-only.
- Manager state is `open|clearing|closing|closed`. `clearCache()` synchronously
  claims `open→clearing` before its first await; a second clear and every new
  ensure/read reject `ShadowAssetStoreError` while it waits. Flights admitted
  before the claim settle, then clear removes the whole adapter store, awaits
  acknowledgement, verifies all-zero usage, and returns to open. `inspectUsage`
  admitted after the claim waits for that clear and observes its resulting
  state. Clear failure returns to open with actual retained state. Close fences
  new work, waits an admitted clear, then closes; it never reopens.
  Quota errors report
  used/required bytes and explicit clear recovery; no ensure/update path sweeps
  or auto-deletes.
- Close rejects new work, settles flights/waiters, and attempts source then
  storage close. One failure rejects `ShadowAssetStoreError {phase:'close'}`;
  multiple failures reject `AggregateError` containing those typed errors in
  causal order. Repeated close returns the same settlement. Abrupt owner death is outside this realm-local
  interface and becomes a MessagePort deadline concern in the next item.

## Observable proof

1. A real pinned esbuild-wasm tarball fills `MemoryVfs`, publishes one verified
   receipt, and reads exactly 13,918,738 bytes; a second ensure is a verified hit
   with zero source requests.
2. Fresh install with a non-empty plan exits success only after `ready`;
   post-tree persistence failure returns the typed tree result and never claims
   asset readiness. Empty-plan install is unchanged.
3. Clearing only objects re-extracts from tarball cache offline; clearing both
   store and tarball cache fails within the bounded-fetch contract.
4. Concurrent ensures share one writer. Cancellation, close, corrupt/torn
   state, quota, and every extraction boundary settle all callers honestly.
5. A mutation-barrier throw leaves the tree byte-identical. Fault the first
   `link` write after a successful barrier and prove the authority was fenced
   before any partial tree can become observable; operation progress/cancel is
   delivered only to the install that supplied it.
6. A direct local/object or joined-flight read that never settles rejects at
   its effective deadline with exact `ShadowAssetReadError` fields; the shared
   ensure flight, if any, remains available to other waiters.

## Parity cases

1. STD extracted bytes == pinned tarball member == descriptor sha256.
2. Tarball SRI mismatch preserves the existing typed `EINTEGRITY` cause inside
   `ESHADOWASSET`.
3. Install with no required assets preserves current lockfile/tree/result shape and
   performs zero manager/source calls.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `corrupt-input` | malformed/duplicate/link/unsafe/oversize member | no object/receipt/ready publication |
| `torn-state` | fail each publish acknowledgement/read-back | later lookup is a miss; never false ready |
| `poisoned-cache` | bytes change under object/receipt/pointer key | hash/digest validation rejects and recovers |
| `concurrent-same-key` | install/ensure starts one missing hash; reads join | one writer; every waiter settles; reads never start transport |
| `false-fallback` | object absent/corrupt, valid tarball cached | offline re-extraction succeeds before network |
| `false-fallback` | object and tarball absent, network fails | bounded named failure; no retry loop or readiness |
| `quota-perm-fail` | persist/clear acknowledgement fails | typed visible failure; readable verified data retained where possible |
| `observable-order` | ensure/read/inspect/second-clear races a claimed clear | prior flights settle; new mutation rejects; inspect linearizes after clear; acknowledged result is zero |
| `unbounded-read` | registry/tarball stall or cap breach | bounded abort; no readiness pointer |
| `provenance-lie` | source manifest/SRI or fallback fact drifts | reject or record actual source; never planned provenance |
| `observable-order` | pre-tree failure vs post-tree asset failure | rollback/no tree result vs typed partial tree outcome |
| `observable-order` | tree mutation starts before authority barrier or ensure loses operation options | callback precedes first write exactly once; scoped progress/cancel reaches ensure |
| `unbounded-read` | local object read or joined waiter never settles | only that direct waiter rejects `ShadowAssetReadError {reason:'deadline'}` within the fixed ceiling |

## Out of scope

- Worker spawn, kernel capability publication, or MessagePort framing.
- Physical Workbench store paths, owner lifetime, public UI, or install stamp v4.
- Eddy acceleration, automatic GC, and external runtime adapters.

## Decisions

- Manager owns correctness; storage/source adapters own only their external
  mechanics and expose acknowledgements.
- Semantic storage entries keep the module deep and future composition
  conflict-free.
- No partial install success: tree state may be independently proven, but the
  command fails until asset readiness exists.
