# ADR 0261: Root-bound serialized install trust claims and non-transferable claim ingress

Status: Accepted
Date: 2026-07

> TL;DR: one owner authority publishes a root-bound v3 install claim only after
> proving the guarded dependency tree; claim metadata never transfers with project
> trees, while background durability and learned-pin SWR remain unchanged.

## Context

Supersedes ADR-0216 and ADR-0241. Their background-exit, durability,
exact-artifact, migration, learned-pin, and fault history is grafted here.

Profiling put about 490ms of visible `npm install` tail on the OPFS drain.
Native npm does not fsync `node_modules` before exit. The browser-specific risk
is later TRUSTING a claim whose tree was never proven durable. Pending-first
claims make that window a reinstall, never false reuse.

The first command implementation spread ownership across generations, locks,
chains, write-site rechecks, boot promotion ids, and a demote proof ladder.
Recurring torn-state findings proved the missing abstraction: one serialized
state owner, consistent with ADR-0224's owner-realm acquisition seam.

ADR-0241 made request and artifact identity exact, but not claim location. A
trusted v2 marker minted at `/a` remained trusted after its bytes, matching
`package.json`, and tree were copied to `/b`; the same RED reproduced on
MemoryVfs, SyncMirrorVfs, and the OPFS pair. This is `lossy-aggregate`: the
claim omitted one dimension of the state it attested. Shell/page copy and
rename, direct `fs.copyFile`, project Save, and dependency-snapshot rebase can
all transfer claim bytes. Root binding alone still permits replaying saved
same-root bytes after a guarded revoke.

Claim metadata is Rifty authority state, not dependency payload. Node-visible
tree operations should keep user/package bytes, but cannot be allowed to mint
or transport trust.

ADR-0194's 30-minute learned-pin hard drop also re-paid a 1--2.7s foreground
POST for an immutable content-addressed bundle. Live proof showed pinned GET
bytes stable next-day. Bounded stale reuse remains safe and unchanged.

## Decision

### Root-bound claim identity

- The claim stays at `<root>/node_modules/.rifty-install-stamp.json`. One state
  machine owns `absent -> pending -> trusted`; pending never satisfies reuse.
- Schema v3 carries the canonical normalized absolute `root`, project slug,
  exact `package.json` text, package count, and `installArtifactIdentity`.
  Constructors require the concrete root. Readers accept a claim only when its
  embedded root exactly equals the canonical root from which it was read.
- Relative/non-canonical roots, v1/v2, malformed shapes, root mismatch,
  missing exact text/identity, current identity mismatch, or current package
  text mismatch are misses and run real arrival. Aliases such as `/work/.`
  canonicalize to `/work`; they neither invalidate nor fork one root.
- `installArtifactIdentity` remains `sha256:<hex>` over canonical JSON of exact
  baked overrides, internal shims, `esbuild-runtime-policy.json`, and generated
  esbuild output digest. Object keys sort recursively; array order, strings,
  and shim contents stay byte-exact.
- Snapshot v2 still carries exact request and artifact identity, but its
  `nodeModules` payload is claim-free. Metadata migration is allowed only after
  proving embedded artifact bytes equal current generated output; otherwise
  `pnpm snapshots:bake` is required.
- This is not a `node_modules` content hash. Later uncoordinated corruption is
  caught only by the owner mutation/durability path; no full-content claim is
  made.

### Non-transferable reserved metadata

- Every path whose final components are
  `node_modules/.rifty-install-stamp.json`, including nested projects, is a
  reserved claim path. Only the install-stamp authority may directly create,
  overwrite, copy to, rename to/from, or change it. External exact-path
  mutations fail before apply with a deterministic `EPERM`-class error; they
  never report success after silently dropping a requested file operation.
- The shared owner mutation seam owns one recursive ingress policy. It plans
  the actual source-to-target mapping before mutation and covers Shell,
  runtime `fs.*`, page VFS/HostCommit, git worktree writes, project operations,
  npm linker/tarball ingress, and future producers. A source grep remains
  defense in depth, not proof.
- Production enforces that policy at `OwnerVfsAuthority`, the deepest
  playground-owned FsSync seam shared by those writers. Its ordinary interface
  cannot bypass reserved paths. Construction creates one non-ambient,
  claim-specific I/O capability (read/write/remove claim for a canonical root)
  and gives it only to `InstallStampAuthority`; a privileged raw FsSync or
  exported bypass is forbidden. The outer mutation guard still owns package
  FIFO/durable transitions, so the namespace gate is not a second state owner.
- Whole-tree copy keeps dependency/user bytes but excludes reserved claim
  entries at every depth from its precomputed plan. Whole-tree rename removes
  every source claim before the rename in the same write-through FIFO, so a
  persisted rename implies the removals persisted first. If an adapter cannot
  prove exclusion/removal-before-transfer, it rejects before mutation. A
  post-transfer cleanup is never a safety mechanism.
- Ancestor deletion/reset remains supported: the authority durably revokes
  affected claims before real mutation. Direct access to the reserved file is
  not a Node-parity surface; real Node does not create this Rifty metadata.
- Project Save/export and dependency-snapshot bake exclude claims at every
  depth. Archive/snapshot consumers validate the complete mapping before any
  write and reject claim-bearing ingress; dependency-snapshot rejection falls
  back to real install. Rebase transfers dependency bytes only. The destination
  authority demotes before restore and mints the target-root claim only after
  its ordinary proof. User workspace archives continue rejecting any
  `node_modules` segment.
- Registry/Eddy tarballs are fully parsed before link; a member that would land
  on a top-level or nested reserved claim path fails install loudly. It is not
  silently dropped from integrity-verified package bytes. The active claim
  remains pending, so a partial earlier link cannot become trusted.

### Serialized authorities

- One injected owner-realm install-stamp authority per concrete store owns
  `check`, `demote`, `promote`, and `revoke`. Root-local transition writes are
  FIFO. Terminal install, automatic ensure, snapshot restore, manifest edit,
  reset, bootstrap, and the recursive ingress policy consume the same instance.
- Roots normalize before lookup and I/O. Equivalent aliases share one queue and
  epoch domain. The package-acquisition authority separately serializes
  dependency operations; callbacks and diagnostics cannot become state owners.
- Every acquisition mutation which can leave the tree starts with `demote`;
  whole-tree reset starts with `revoke`. Demote issues a fresh epoch bound to
  canonical root and slug. An older or re-keyed promoter loses. Restart reads a
  materialized pending claim as pending, never trusted.
- On a durable backend, demoting trusted returns only after pending is proven
  durable. Claim-write failure falls back to durable removal. If neither is
  proven, the mirror restores prior trusted and mutation aborts loudly.
- The potentially parked promotion proof sits outside the transition queue.
  Final root/identity/tree/claim probes run in one serialized commit slot and
  recheck the epoch after yielding. New demote fences an older promoter.
- `SyncMirrorVfs.writeFile` follows Node and does not create missing parents;
  the authority cannot resurrect a deleted tree through a lenient twin.

### Durable promotion

- Promotion admits only its current canonical-root/slug epoch. It requires the
  guarded tree, current exact package request, and absent-or-matching pending
  claim. It never mkdirs a deleted tree just to write trust.
- OPFS promotion asks the FULL persistence ledger, not its bounded sample,
  exactly once while active pending. Any unhealed failure under `node_modules`
  or at the pending claim blocks publication and leaves a miss.
- One serialized commit slot rechecks root, epoch, exact `package.json`, tree,
  and pending claim before writing trusted. That write is the final marker over
  already-proven bytes; no trusted candidate exists before proof and no
  post-marker rollback participates in safety.
- A marker write throwing before mutation leaves pending/corrupt bytes: miss.
  A throw after mutation may leave truthful trusted bytes over the already
  proven exact tree; the live authority stays pending and returns
  `write-failed`. Marker durability is best-effort; reload sees pending/corrupt
  or safe trusted. Reload-survival acceptance awaits an outer flush.
- Watchdog timeout is a ledger failure before publication. Late settle follows
  the ledger sequence fence; only a later clean proof may publish.

### Background command durability

- `npm install` resolves after link, shims, and lockfile. With OPFS, pending
  ledger proof and final publication run un-awaited; failures surface
  asynchronously. Successful tree mutation stays command-successful when later
  claim promotion is refused.
- Demotion proof for existing trusted remains before the first tree mutation.
  Tree preparation stays inside the acquisition FIFO. Failed/no-op mutation
  leaves pending/absent; it never revives prior trust over possibly changed
  bytes.
- Reload during the background window may reinstall. This matches native npm's
  non-fsync tail: self-heal, no crash, no trusted torn tree. Reload-survival
  acceptance awaits an outer flush; a fast-reload case proves the raced window.

This supersedes ADR-0187 only for its command-site "return only when durable"
clause. Its persist-ledger, checked-drain, FIFO, and pending-boot rules stand.

> Corrected (2026-08-15): ADR-0187 is now fully superseded by ADR-0358 — the
> FIFO-order clause falls to bounded per-path lanes + an explicit stamp full
> fence; the persist-ledger, checked-drain, and pending-boot rules continue
> there unchanged.

### Learned-pin SWR

- Learned pins are fresh for age `< 1800s`; age `>= 1800s && < 24h` serves
  stale through immutable pinned GET with an honest as-of line and one bounded
  manifest-only POST revalidation. Age `>= 24h` is absent and pays foreground
  POST.
- GET/prefetch cache serve never rewrites `savedAt`. Only a server-vouched POST
  adoption may write it; `prefer:'online'` guarantees recomputation.
- Install write-back is compare-and-set against the servable pin observed at
  start. Background revalidation is compare-and-set against the served stale
  hash. A newer learn wins; hard-expired raw state behaves as absent.
- Buffered pinned prefetch is adopted only while its hash is still current;
  expiry/replacement cannot bypass the decision gate.
- `resolveEddyClosure()` owns manifest-only revalidate. Public
  `InstallResult.resolvedAt` and `resolvedVia: 'get' | 'post'` preserve served
  age/request provenance. `EDDY_STORE_DURABLE_HEADER` remains the shared proof.
- Environment pins have no age gate. Revocation rotates/redeploys affected
  pins; mutable server caches may require restart within TTL. The hosting
  runbook owns both escape hatches.

This supersedes ADR-0194 only for its learned-pin 30-minute hard-TTL clause.

## Acceptance

- Shared MemoryVfs, SyncMirrorVfs, and OPFS-pair contract: mint at A, copy
  marker plus matching package/tree to B, flush/restart, and B is absent while
  A stays trusted. Repeat via direct copy and recursive tree copy.
- v2, missing root, non-canonical root, wrong root, and corrupt root are misses;
  canonical aliases read the same v3 claim. Sync and async readers agree.
- Save trusted A bytes, guarded-mutate/revoke A, then attempt direct write,
  copy, and rename back to A's reserved path. Every ingress rejects before
  apply; restart cannot trust the saved claim.
- Shell copy/move, page VFS copy/rename, runtime `copyFile`/rename/write,
  HostCommit, git checkout/reset/apply, project Save, and snapshot rebase cover
  top-level and nested claims. Multi-path failure applies no user bytes.
  Recursive transfers retain ordinary bytes and contain no claim at any depth.
- A registry and Eddy install of a tarball containing a nested reserved marker
  fails loudly before that package links the marker; no authority check can
  return trusted for it after reload.
- Snapshot producer output is claim-free. A hand-authored top-level or nested
  claim in snapshot/archive input rejects before replace; destination remains
  byte-identical. Verified claim-free restore is pending until the destination
  authority publishes after proof.
- A parked old promoter cannot publish across transfer/reset/new demote.
  Root-bound pending/trusted marker faults retain every superseded stamp RED row.

## Fault matrix

| Fault | Required outcome |
|---|---|
| `lossy-aggregate` | Canonical root joins exact request/artifact identity; distinct roots cannot share a claim. |
| `torn-state` | Transfer excludes/removes claims before bytes can become trusted at target; never safety by cleanup-after. |
| `concurrent-same-key` | Aliases share one epoch; new demote fences old proof/final-slot promoter. |
| `quota-perm-fail` | A failed or hung persistence drain stays outside transition FIFO; install exit remains background. |
| `poisoned-cache` | v1/v2, root mismatch, marker-bearing snapshot, and saved same-root replay cannot restore trust. |
| `provenance-lie` | Cache serve cannot refresh age; terminal reports served manifest age. |
| `sibling-drift` | One recursive reserved-ingress policy covers all writers, transfers, and nested markers. |

## Rejected alternatives

- **Root-bound v3 alone:** closes A→B but not saved A→A replay or round-trip
  A→B→A. Claims must also be non-transferable authority metadata.
- **Writer-specific strip/reject only:** another writer or nested marker reopens
  the class; source AST checks do not cover runtime recursion. One ingress seam
  owns the set.
- **External claim store:** avoids ordinary project copies but loses the
  co-located fail-safe (tree removal naturally removes its claim), needs a
  root-key namespace/GC and broader affected-root discovery, and makes a missed
  guard able to leave trust detached from replaced bytes. Root-bound local
  claims keep that locality without a second store lifecycle.
- **Post-copy/post-rename cleanup:** crash between transfer and cleanup can
  expose a valid replay. Exclude/remove before transfer or reject.
- Keep v2 and infer root from location: copied bytes have no evidence of where
  they were minted; location inference repeats the bug.
- Keep generations/chains/write-site rechecks, put drains in the transition
  FIFO, write trusted before proof, add candidate files, or await command
  promotion: these retain the superseded ownership/latency faults.
- Refresh learned-pin age on GET: active use self-renews stale resolution past
  the 24-hour bound without server evidence.

## Consequences

- Existing v2 claims deliberately miss once. Warm startup returns after v3 is
  minted; copied projects reinstall instead of inheriting trust.
- Tree copy/move keeps dependency and user bytes but not Rifty claim metadata.
  Direct manipulation of the reserved claim path fails loudly.
- Snapshot/index/archive flows transfer bytes only; the destination authority
  is the sole minter of target trust after proof.
- Prompt tail and learned-pin behavior remain superseded-ADR-equivalent: shorter
  visible install tail, bounded reload re-install window, and ≤24h honest SWR.
- `trusted` means truthful in the current realm, not fsynced marker publication.
  Callers needing reload survival await the outer VFS flush.
- First-install generated-baseline absorption may still await its global flush;
  this decision makes no broader performance claim.
