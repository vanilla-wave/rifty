# ADR 0249: Owner-managed shadow runtime assets in a Workbench content store

Status: Accepted
Date: 2026-07

> TL;DR: substitutions declare exact integrity-pinned assets. One Workbench
> owner makes the applied set ready at the package-acquisition boundary: before
> generic/snapshot project admission, or inside a visible cold install before
> runtime spawn. Children receive verified bytes through an entry capability,
> never deployment config, env, Node IPC, or guest VFS.

## Context

Install redirects `esbuild` to an alias package, while the executed
13,918,738-byte `esbuild.wasm` enters through a host `?url` import and
`RIFTY_ESBUILD_WASM_URL`. Install provenance, runtime bytes, and offline
readiness therefore disagree.

Workbench now owns one physical origin-locked owner and sequential
`ProjectSession` values. Its single `OwnerVfsAuthority` protects private owner
state and projects through rooted views. ADR-0278 also makes cold Playground
first materialization deliberately visible: `openProject` returns the
session/default terminal before `session.run()` executes the real
`npm install`. Runtime-asset readiness must compose with both facts rather than
restore a page-owned store or hide cold install behind project open.

## Decision

### Declarative plan

- Builtin catalogs are clone-safe data with stable id/schema/digest. Exact
  public versions map to logical asset id, exact source package/version/SRI,
  normalized archive member, member sha256/size, and exact
  tarball/decompressed caps. Missing maps loud-throw
  `NotImplementedError('shadow-registry.<name>@<version>.assets')`.
- A typed trace records only substitutions actually applied. One pure planner
  produces a canonical `ShadowAssetPlan`; terminal text, installed-name
  coincidence, semver inference, and app-global catalogs never participate.
  Source package/version colliding with a trigger/override throws
  `ESHADOWASSETSOURCE`.
- Tree and asset identities are independent. Overlay/synthetic package/runtime
  JS changes flip `installArtifactIdentity`; descriptor pins flip only the
  required-set digest.
- Catalog data may name a runtime-adapter id but cannot install executable
  lifecycle hooks. Workbench v0 resolves only owner-bundled adapters. External
  catalogs/adapters remain a separate public-interface decision; host functions
  never cross structured-clone boot IPC.

### Manager and install result

- npm-client owns one deep realm-local `ShadowAssetManager` split by authority:
  installer `ensure`/`inspectReceipt`, runtime `readVerified`, admin
  `inspectUsage`/`clearCache`, and manager-only `close`. Children receive only
  an exact-plan-scoped runtime reader.
- Storage is injected through semantic `temp|object|receipt|ready` entries plus
  acknowledgement, usage, and clear. No npm-client type contains a
  Workbench/project id or physical path.
- Manager owns single-flight, bounded STD source transport, exact-member
  extraction, SRI/member verification, verified publish order, immutable
  receipts, recovery, and shutdown. Storage/source adapters own external
  mechanics, not correctness.
- Publish is temp -> acknowledged object -> read-back hash -> acknowledged
  immutable receipt -> acknowledged required-set pointer last. Lookup validates
  pointer, receipt, and objects. Rename atomicity is never assumed.
- A hit re-verifies bytes. A miss first tries a valid SRI-keyed tarball cache,
  otherwise exact registry manifest name/version/SRI and its bounded tarball.
  Catalogs contain no registry URL.
- Receipt carries catalog/substitution/adapter/source/member facts, actual
  transport/cache result, storage class, and set digest. Store hits do not
  rewrite immutable provenance.
- `install()` validates its plan/manager before tree mutation and awaits asset
  readiness after `InstallTreeResult`. A non-empty plan adds the exact
  `shadowAssets: ready(plan,receipt)` result; an empty plan preserves the
  existing result shape. Post-tree failure is typed `ESHADOWASSET` with the
  exact tree result; tree provenance stays independent and command success is
  never reported.

### Worker adapter and kernel composition

- npm-client owns a versioned exact-plan-scoped async `MessagePort` runtime
  reader with `read|progress|result|error|cancel|dispose` frames, one fixed
  30-second read ceiling, and typed clone-safe error envelopes. Direct deadline
  expiry is `ESHADOWASSETREAD`; the port maps it to `ESHADOWASSETPORT/deadline`
  and manager clear/close state to `ESHADOWASSETPORT/closed` without sending a
  store error.
- Result transfers one response-owned bounded `ArrayBuffer`. The 1 MiB SAB
  sync-RPC, env, stdio, and guest Node IPC are forbidden.
- ADR-0266 transports the child endpoint under
  `rifty.shadow-assets.v1` on the URL entry beside ADR-0267 bootstrap metadata.
  `KernelProcessSpec` remains process identity only. Caller-owned sessions start
  before spawn and settle on spawn failure, exit, kill, project close, and
  Workbench close.

### Workbench owner and private storage

- Owner boot selects/installs storage, runs the existing owner-born
  `persisted()`/`persist()` retention probe, then constructs the single
  `OwnerVfsAuthority` over `syncMirror()`. A path-neutral
  `ShadowAssetStorage` adapter is built over that authority before project-rooted
  views, then manager, package authority, and owner readiness.
- Semantic entries map to
  `/.rifty/workbench/v1/runtime-assets/v1/{objects,receipts,ready,tmp}`.
  Project VFS, children, snapshots, exports, SCM, root rm, traversal, and
  `deleteProject` cannot reach it. Privacy comes from the one private owner
  authority plus rooted project capabilities, never from a captured raw backend
  or a magic path check.
- The origin-wide `rifty:workbench:v1` Web Lock admits one owner. Sequential
  projects and later Workbench lifetimes share OPFS cache; memory is
  owner-session only. `deleteProject` retains the cache. Explicit
  `workbench.runtimeAssets.clear()` removes it after manager-flight settlement
  and storage acknowledgement.
- Write durability and browser eviction retention stay distinct owner-born
  facts. Runtime-asset storage class is `opfs-persisted` only for durable OPFS
  plus confirmed persistent grant, `opfs-best-effort` for other durable OPFS,
  and `memory-session` for memory. Retention is exposed by
  `runtimeAssets.inspect()`; general `OwnerStorageSnapshot` does not grow.
- Persist acknowledgement is scope-aware over the one authority: asset writes
  accept only failures under the semantic asset root; project materialization
  accepts only project-scope failures. The final owner flush still aggregates
  every scope. A failure in one scope cannot prove or disprove durability in
  the other.
- Public Workbench exposes semantic `runtimeAssets.inspect()/clear()` and
  optional typed `WorkbenchProjectOpenOptions.onRuntimeAssetProgress`.
  `PlaygroundProjectOpenOptions` extends that root type with
  `initialTerminalState`. Both compositions forward exact options; observer
  throws are reported and isolated from acquisition. Public
  `RuntimeAssetError {code:'ESHADOWASSET',phase,recovery,requiredSetDigest?,
  assetId?,usedBytes?,requiredBytes?}` is reconstructed from one strict
  clone-safe owner envelope. Its message comes from a fixed public phase table,
  never the internal error message; causes, stacks, transports, URLs, tree
  result, plan, paths, and owner ids stay private.
- Progress is per-asset canonical index/count over
  `cache-check|fetch|verify|persist` plus one final `ready` carrying set digest
  and storage class after acknowledgement. Empty plans emit nothing. Inspection
  reports total semantic entries/decoded bytes, verified objects/bytes, and
  valid ready sets; tarball/project storage is excluded.
- `inspect` is read-only until close. `clear` adds one `clearing` branch to the
  existing Workbench project-operation state machine and synchronously claims
  only idle. Opening/active/deleting/clearing is `ProjectBusyError`. Exact
  owner wire uses operation ids for inspect, clear, progress, result, and
  failure; the browser pending-operation map remains the sole correlator.
  Generic and companion delete both enter the same root `deleting` operation;
  the companion never bypasses it with a direct catalog call.

### Acquisition timing and install claims

- One named FIFO `post-tree runtime-asset readiness` seam handles every trusted
  existing, verified snapshot, and installed-tree outcome. It receives the exact
  `ShadowAssetPlan` plus an already-ready install receipt when present; it never
  repeats an install-owned ensure. No app catalog, unattested lockfile, or early
  trusted-return bypasses it.
- `InstallOptions.shadowAssets` groups the least-authority installer with one
  operation's signal/progress observer. `install()` passes it to
  install-owned ensure and retains nothing. `onTreeMutationStart` fires exactly
  once after preflight and immediately before first `link` write; Workbench
  routes it to the same owner mutation barrier, and a throw aborts before link.
- `OwnerPackageState` retains the installed-tree epoch privately as
  `{project:{root,slug}, sequence,
  readiness:unavailable|not-required|pending(plan)|ready(plan,receipt)}`. It is never added to
  `ProjectAcquisitionPlan` or page wire. Active project identity must match;
  project switch publishes unavailable before a deferred-cold session returns.
  Pure pre-mutation validation failure keeps the old epoch. One idempotent
  acquisition-token-bound `beginTreeMutation` makes it unavailable immediately
  before owner prepare/clear, snapshot apply, reset/switch, tree-demotion ingress,
  or npm-client link; `onTreeMutationStart` invokes that same barrier.
  Successful empty-plan install publishes `not-required`; non-empty success
  atomically publishes its returned plan/receipt. Typed
  post-tree asset failure plus successful finalization publishes its exact plan
  pending for retry; other failures expose no stale epoch. Trusted/snapshot
  paths publish pending before external ensure. `package.json`-only and
  `package-lock.json`-only edits are `package-only`: they demote v4 trust but do
  not change the installed tree epoch. The shared mutation executor classifies
  `node_modules`/ancestor impact as `tree` and crosses the same barrier before
  its first write.
- Generic root Workbench performs its actual install/reuse during
  `openProject`. Its required set is ready before `project-opened`, and its open
  callback receives progress.
- Playground companion trusted-existing and valid-snapshot outcomes are also
  ready before `project-opened` and may report through the open callback.
  `firstMaterialization: install` and rejected-snapshot fallback return the
  session/default terminal first as required by ADR-0278. Their first
  `session.run()` visibly executes `$ npm install`, ensures assets after the
  tree and before Vite/Node child spawn, and renders progress in the terminal.
  The open callback is not retained for this later work. Failure leaves the
  acquisition decision retryable; first success consumes it in owner terminal
  state, so later runs never prepend another implicit install.
- Later terminal installs use the same package FIFO and ensure assets after
  their new tree but before exit zero. Manifest mutations remain FIFO and
  demote v4; the next tree-ready install/reuse recomputes the plan. Child
  admission is a FIFO command: it retries a pending exact epoch, then publishes
  a package-private reservation while the FIFO stays held. Without awaiting,
  the caller creates the exact-plan port session, performs the synchronous
  physical Worker spawn, attaches cleanup, and commits; throw aborts and closes
  once. A post-spawn/pre-commit throw terminates and observes the unexposed
  child, disposes its session, and retains the FIFO until settlement before
  surfacing the original error. Commit/abort makes physical spawn the admission
  linearization point; `not-required` uses the reservation without a port. It
  never replans from concurrently edited manifest/
  lockfile bytes. Mismatched project or unavailable state fails loudly as
  `EUNATTESTEDPACKAGETREE` until install/reuse succeeds.
- Install claims advance to v4: retain v3 fields and add
  `lockfileSha256` as exactly 64 lowercase hex digits over the stored
  `package-lock.json` bytes. Promotion and trusted checks re-read exact
  manifest/lockfile bytes. v1-v3, missing, edited, or mismatched lockfile is a
  miss. Manifest writers use ADR-0283 `serializePackageJson`; no second
  canonicalization is introduced.
- Browser WebCrypto cannot prove that hash synchronously. An on-disk v4 makes
  `InstallStampAuthority.checkSync()` conservatively return absent to boot
  prefetch without changing authority phase; async `check()` is the sole
  exact-byte trust gate. No synchronous SHA implementation is copied/exported.
  A redundant bounded warm Eddy prefetch is accepted and cannot mint trust.
- A typed `ESHADOWASSET` is recognized before `npm-shell-command` generic
  package-add rollback. Preserve the post-install `package.json` and lockfile,
  then run `finalizePackageInstallFiles`. Only a successful finalizer may return
  the internal `post-tree-failure {treeResult, packageJsonText,
  lockfileSha256, error}` to acquisition authority for ordinary independent v4
  promotion scheduling. The authority then rethrows the original asset error
  and admits no runtime/asset-ready receipt. A failing generic open returns no
  new session; an already-open companion session remains usable for recovery.
  If finalization also fails, do not promote and throw
  `AggregateError([assetError, finalizerError])` in that order.
- Project close fences admission, closes children/ports, then quiesces package
  work, closes manager sessions, and flushes while retaining cache. Generic and
  companion owner close both settle project authority, package FIFO, manager,
  and final authority flush before owner exit and Web Lock release.

### Vite, deployment, and measurement

- In the final Workbench join, remove npm-derived esbuild from
  `deployment.wasm`, strict boot protocol, host imports,
  `NodeWorkerRuntimeConfig`, recursive host bootstrap, and
  `RIFTY_ESBUILD_WASM_URL`. Host-owned SQLite remains. The preceding Workbench
  controller/extraction item keeps transitional `deployment.wasm.esbuild`.
- Removing that exact host-runtime field atomically bumps
  `NODE_ENTRY_BOOTSTRAP_PROTOCOL` from `rifty.node-entry/v1` to
  `rifty.node-entry/v2` across every builder, decoder, and recursive spawner.
  There is no v1 dual-read or env fallback; a node entry carrying v1 rejects
  with the existing protocol-mismatch error before pre-entry/runtime admission.
- Default `vite@8.0.16` has an empty esbuild asset set. Explicit
  `vite@7.3.6` exercises exact esbuild 0.28.0 delivery. Both require acceptance
  proof; asset pins never alter project-definition identity.
- The cold STD benchmark uses the generic public Workbench root with explicit
  Vite 7.3.6, so `cache-check` through acknowledged `ready` is an
  `openProject` interval. It records five fresh contexts after one discarded
  origin warm-up, decoded response bytes, close/lock release, and the exact host
  boundary. The Eddy item adds the matched accelerator row.

### Delivery order

~~~text
catalog + exact planner
          |
          v
manager + STD/store
          |
          v
MessagePort adapter ---------+
                             |
kernel entry capabilities ---+--> Workbench runtime assets
                             |
Workbench controllers -------+
                                      |
                                      v
                         Eddy / alias retirement
~~~

Catalog, manager, and MessagePort items touch only shadow-registry/npm-client.
Kernel can start immediately on landed ADR-0267. Workbench files change only in
the final join after controller extraction.

This ADR composes with ADR-0267: entry capability ports are a sibling to host
bootstrap. It narrowly corrects ADR-0263's host-resolved esbuild deployment
field/root interface and ADR-0261's install-claim schema/asset-only identity
projection; their other decisions stand.

## Consequences

- Executed bytes gain npm provenance, bounded extraction, verified receipts,
  storage-qualified offline claims, and one progress/error vocabulary.
- One origin-private cache avoids 13.3 MiB duplication across sequential
  projects while one owner/Web Lock preserves a single writer.
- npm-client stays path/owner-neutral; Workbench adds one semantic adapter and
  lifecycle join rather than a manager rewrite.
- Cold STD install adds one serial bounded asset fetch after the tree. The
  admitted member is 13,918,738 bytes; seconds and response bytes are measured
  in the Workbench bench row, and the Eddy item adds its matched row.
- Existing v3 claims miss once so v4 can attest exact lockfile bytes.
- Warm sync prefetch may do redundant bounded work because only async WebCrypto
  can prove v4; correctness never depends on that speculative result.
- This does not generalize runtime adaptation for Sass, SWC, sharp, or arbitrary
  external adapters; each remains an explicit parity/public-interface decision.
