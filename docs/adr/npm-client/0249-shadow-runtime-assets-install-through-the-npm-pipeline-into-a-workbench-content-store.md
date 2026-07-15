# ADR 0249: Owner-managed shadow runtime assets in a Workbench content store

Status: Accepted
Date: 2026-07

> TL;DR: substitutions declare exact integrity-pinned assets. One Workbench
> owner manager makes the applied set ready in an origin-private cache before
> project admission; children receive verified bytes through a dedicated
> capability, never host deployment config, env, Node IPC, or guest VFS.

## Context

Install currently redirects `esbuild` to an alias package, while the executed
13,918,738-byte `esbuild.wasm` enters through a host `?url` import and
`RIFTY_ESBUILD_WASM_URL`. Install provenance, runtime bytes and offline
readiness therefore disagree.

The first asset-store design assumed a `workspaceId`, a second storage-key
encoder and page-threaded persistence grant. Workbench instead owns one physical
origin-locked owner and sequential `ProjectSession` values. Project ids already
have an injective storage identity; assets are immutable and shared across
projects. A project-scoped copy would repeat the cold cost without improving
authority.

## Decision

### Declarative plan

- Builtin catalogs are clone-safe data with stable id/schema/digest. Exact
  public versions map to logical asset id, exact source package/version/SRI,
  normalized archive member, member sha256/size, and exact tarball/decompressed
  caps. Missing maps loud-throw
  `NotImplementedError('shadow-registry.<name>@<version>.assets')`.
- A typed trace records only substitutions actually applied. One pure planner
  produces a canonical `ShadowAssetPlan`; terminal text, installed-name
  coincidence, semver inference and app-global catalogs never participate.
  Source package/version colliding with a trigger/override throws
  `ESHADOWASSETSOURCE`.
- Tree and asset identities are independent. Overlay/synthetic package/runtime
  JS changes flip `installArtifactIdentity`; descriptor pins flip only the
  required-set digest.
- Catalog data may name a runtime-adapter id but cannot install executable
  lifecycle hooks. Workbench v0 resolves only owner-bundled adapters. External
  catalogs/adapters remain a separate public-interface decision; host functions
  never cross structured-clone boot IPC.

### Manager

- npm-client owns one deep, realm-local `ShadowAssetManager` split by authority:
  installer `ensure`/`inspectReceipt`, runtime `readVerified`, admin
  `inspectUsage`/`clearCache`, and manager-only `close`. Children receive only
  an exact-plan-scoped runtime reader; its deadline/signal/progress options stay
  local to each adapter realm.
- Storage is injected through semantic
  `temp|object|receipt|ready` entries plus acknowledgement, usage and clear.
  No npm-client type contains a Workbench/project id or physical path.
- Manager owns single-flight, bounded STD source transport, exact-member
  extraction, SRI/member verification, verified publish order, immutable
  receipts, recovery and shutdown. Storage/source adapters own external
  mechanics, not correctness.
- Publish is temp → acknowledged object → read-back hash → acknowledged
  immutable receipt → acknowledged required-set pointer last. Lookup validates
  pointer, receipt and objects. Rename atomicity is never assumed.
- A hit re-verifies bytes. A miss first tries a valid SRI-keyed tarball cache,
  otherwise exact registry manifest name/version/SRI and its bounded tarball.
  Catalogs contain no registry URL.
- Receipt carries catalog/substitution/adapter/source/member facts, actual
  transport/cache result, storage class and set digest. Store hits do not
  rewrite immutable provenance.
- `install()` validates its plan/manager before tree mutation and awaits
  readiness after tree completion. Result is
  `shadowAssets: not-required|ready`. Post-tree failure is typed
  `ESHADOWASSET` with exact `InstallTreeResult`; tree provenance stays
  independent and command success is never reported.

### Worker adapter

- npm-client owns a versioned, exact-plan-scoped async MessagePort runtime
  reader with
  `read|progress|result|error|cancel|dispose` frames, finite deadlines and
  typed clone-safe error envelopes.
- Result transfers one response-owned bounded `ArrayBuffer`. The 1MiB SAB
  sync-RPC, env, stdio and guest Node IPC are forbidden.
- ADR-0266 transports the child endpoint under
  `rifty.shadow-assets.v1`. Kernel remains protocol-opaque. Caller-owned
  sessions start before spawn and settle on failure/exit/kill.

### Workbench composition and experience

- After storage selection, the owner probes browser retention itself, captures
  a root-scoped store adapter, constructs one manager, then package authority,
  then publishes owner readiness. Page boot sends clone-safe policy only.
- Semantic entries map to
  `/.rifty/workbench/v1/runtime-assets/v1/{objects,receipts,ready,tmp}`.
  Project VFS, children, snapshots, exports, SCM, root rm and traversal cannot
  reach it. Privacy comes from the captured capability/project-rooted view, not
  a magic path prefix.
- The existing origin-wide `rifty:workbench:v1` Web Lock admits one owner.
  Sequential projects share the cache; `deleteProject` retains it; explicit
  `workbench.runtimeAssets.clear()` removes it after flight settlement and
  acknowledgement. OPFS survives Workbench close while origin data exists;
  memory does not.
- Write durability and browser eviction retention are distinct owner-born
  facts. Storage class is `opfs-persisted` only for OPFS plus confirmed
  persistent grant, `opfs-best-effort` for other OPFS, and
  `memory-session` for memory. Only the first claims eviction resistance.
- Public Workbench exposes semantic `runtimeAssets.inspect()/clear()` and an
  optional typed `openProject(..., {onRuntimeAssetProgress})` observer.
  Progress is correlated before `ProjectSession` exists; observer failure
  cannot change acquisition. The admin interface remains usable after failed
  open; no raw owner protocol is public.
- Progress is per-asset canonical index/count over
  `cache-check|fetch|verify|persist`, plus one final `ready` carrying set digest
  and storage class after acknowledgement. Empty plans emit nothing. Inspection
  returns storage class, total semantic entry count/decoded bytes, verified
  object count/bytes and valid ready-set count; it excludes tarball/project
  storage. Successful clear returns the acknowledged all-zero inspection.
- Inspect is read-only until Workbench close. Clear synchronously claims only an
  idle Workbench; opening/active project or another clear is `ProjectBusyError`.
  Owner fences admission, waits asset flights, clears and acknowledges before
  returning to idle. Inspect linearizes in owner order and queues behind an
  already-claimed clear. Failed open restores idle so public recovery remains.
- Fresh, trusted-existing and verified-snapshot arrivals invoke one owner hook
  and await the same manager before `project-opened`/runtime. Install stamp v4
  retains v3 and adds sha256 of exact stored `package-lock.json` bytes;
  promotion/check re-read them. Old/missing/mismatched claims are misses.
- Typed post-tree asset failure schedules ordinary independent tree promotion,
  rejects project admission and never attests asset readiness.
- Project close fences admission, closes children/ports, quiesces package work,
  settles project asset sessions and flushes while retaining the cache.
  Workbench close then shuts down manager flights, performs final flush, exits
  owner and releases the Web Lock.

### Vite and deployment

- npm-derived esbuild bytes are neither Workbench deployment configuration nor
  host-bundle input. Remove `deployment.wasm.esbuild`, its host import,
  boot/runtime fields and `RIFTY_ESBUILD_WASM_URL`; host-owned SQLite remains.
- Default `vite@8.0.16` has an empty esbuild asset set. Explicit
  `vite@7.3.6` exercises exact esbuild 0.28.0 delivery. Both branches require
  acceptance proof; asset pins never alter project-definition identity.
- Real-browser benchmark uses the final public Workbench host with explicit
  Vite 7.3.6, five fresh contexts after one discarded origin warm-up, exact
  owner-local `cache-check`→acknowledged `ready`, decoded response-body
  bytes, close/lock-release proof and no legacy query preset.

### Delivery order

The implementation DAG deliberately isolates active Workbench work:

~~~text
catalog + exact planner
          ↓
manager + STD/store
          ↓
MessagePort adapter ─────────┐
                             │
kernel capabilityPorts ──────┼─> Workbench runtime assets
                             │
Workbench controllers ───────┘
                                      ↓
                         Eddy / alias retirement
~~~

Catalog, manager and MessagePort items touch only shadow-registry/npm-client.
Kernel starts after the active bootstrap precursor is isolated. Workbench files
change only in the final join item.

This ADR narrowly corrects ADR-0231's esbuild URL clause and ADR-0263's
host-resolved esbuild deployment field/root interface; kernel/node/SQLite
bootstrap config and Workbench's sealed finite-runtime shape stand. It narrowly
corrects ADR-0261 for install-claim v4 and asset-only identity projection;
owner/root/non-transferability/promotion/durability rules stand.

## Consequences

- Executed bytes gain npm provenance, bounded extraction, verified receipts and
  storage-qualified offline claims; install/runtime share one progress/error
  vocabulary.
- One origin-private cache avoids 13.3MiB duplication across sequential
  projects while the Web Lock preserves a single writer. Project deletion no
  longer implies cache deletion.
- npm-client interfaces stay path/owner-neutral; the eventual Workbench merge is
  one adapter and lifecycle integration, not a manager rewrite.
- Cold standard install adds a serial bounded asset fetch after the tree. The
  admitted member is 13,918,738 bytes. Seconds are measured in the Workbench
  item and the Eddy item adds the matched row; no timeout bound is presented as
  a performance estimate.
- Existing v3 claims miss once so v4 can attest exact lockfile bytes.
- This does not generalize runtime adaptation for Sass, SWC, sharp or arbitrary
  external adapters; each remains an explicit parity/public-interface decision.
