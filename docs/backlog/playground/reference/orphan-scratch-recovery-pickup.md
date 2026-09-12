# I6 orphan Scratch recovery pickup

Read-only DEC-4/DEC-2 research, 2026-09-09. No tracked edits, root build,
implementation, committed tests or new owner/coordinator. I3 source work ran
concurrently. Source read around f39d80a4733012f3f6a075de5055fd227ff90be4 through
0f8ec6f96b35983a141937e86fbadcff2ed3c85b; line numbers must be refreshed at pickup.

## Authority and settled choices

Accepted goal `self-hosted-snapshot-workbench/goal.md:53-55,91-93,123,136` and
`playground/orphan-scratch-recovery.md` settle the material choice: preserve
unjournaled Scratch bytes for public list/download and make a fresh Scratch,
never silently adopt the orphan as a runnable project or delete the only copy.
The intake source at `distribution/reference/embedder-gaps-evidence.md:61-68`
records the actual unjournaled tree/browser refusal; it does not establish how
the original report's orphan arose. No separate private Tracker source is claimed.

No migration/eviction/delete API, arbitrary-project recovery, extra concurrency,
new large-project guarantee, or UI is implied. Names, finite record/API shape,
archive representation and transaction route remain agent-owned. No new user
fork established by this research.

I4 assumption: one selected OPFS handle backs both VFS surfaces; all logical paths
below stay relative to that mount. Namespace omission retains the historic origin
root, and the origin-wide Workbench lease remains. I4 is not implemented here.
The native failure probe deliberately uses today's no-argument origin-root pair;
the same logical Scratch path composes with a selected root later.

## Executed prerequisite: unreadable is currently returned as empty

Actual Chromium148.0.7778.96, Node24.16.0, original VFS source bundled with
esbuild only into `/tmp/rifty-316-orphan-preload-probe/worker.js`. Fresh native
browser context, localhost, real Workers/OPFS/paired VFS. No product method mocked.

A native writer creates this unjournaled source, with no catalog/journal:
`/.rifty/workbench/v1/projects/scratch/tree/user.bin` =
`[0,1,2,127,128,254,255,13,10]` (9 bytes).
The only injected failure is `FileSystemFileHandle.prototype.getFile` throwing
DOMException NotAllowedError for that file during real metadata/preload calls.
Original method is restored before independent durable read-back.

| Observation | baseline | preload read denied | metadata + preload denied | fresh Worker afterward |
|---|---|---|---|---|
| init result | resolves | resolves | resolves | resolves |
| native durable source | exact9 | exact9 | exact9 | exact9 |
| indexed/stat size | 9 | 9 | 0 | 9 |
| sync read | exact9 | empty array | empty array | exact9 |
| sync error | none | none | none | none |
| flush failures | 0 | 0 | 0 | 0 |
| actual copyFileSync persisted duplicate | not requested | empty | empty | not requested |

In the first fault, getFile#1 succeeds with size9; getFile#2 fails. In the second,
both calls fail. Source durable bytes remain untouched in both cases; later paired
async reads and fresh-Worker reads return all9 again. The probe NEVER deletes the
source. Native copyFileSync is also exercised: it writes a real durable empty
`/copied-preload.bin` and reports a clean drain.

Executed command (exit0 means the observations above were asserted):

```sh
node /tmp/rifty-316-orphan-preload-probe/run.mjs
```

Artifacts: `result.json`, `run.log`, `worker.ts`, `run.mjs` in that directory.
Localhost needed a sandbox permission retry. Initial harness-only failure was
DataCloneError from attempting to post flush's method-bearing report; projecting
its actual total/failures fixed the harness. No such error is product evidence.

Exact source chain:
- `vfs/opfs-sync.ts:168-175`: metadata read failure keeps a file indexed with size0.
- `:312-330`: per-file preload read failure leaves no cache entry and is swallowed.
- `:601-613`: known file without cached content returns a fresh empty Uint8Array.
- `:982-1003`: copyFileSync independently has the same empty-content fallback.
- `workbench/workers/playground-catalog-tree.ts:396-419,442-458` copies ordinary
  files through OwnerVfsAuthority.copyFileSync; that owner forwards to underlying
  FsSync (`owner-vfs-authority.ts:278-284`). No independent durable-content check.

The public archive bounded reader checks stat size against read bytes, which
catches the SINGLE preload fault. It cannot establish honesty when BOTH reads
failed and stat=0 agrees with fabricated empty bytes. Clean flush proves writes
settled, not that copied source bytes were real. Re-reading the same warm mirror
or hashing its empty bytes is not an independent proof.

## Required read/copy prerequisite; no broad fix implemented now

Do not build retention on the unmodified warm-mirror copy and then remove its
source. Preferred route at I6 pickup: repair the observed missing-cache honesty
fault for read AND copy through their existing VFS owner, with the native RED
above and sibling sweep (cp/rename use those cache paths too). Real empty files
have an actual zero-length cache entry; a missing entry must not invent bytes.
Capturing/raising the original read failure can remain per-file; no need to make
one unreadable file fail every unrelated project or add a new persistent store.
This is an observed-defect repair, not license for a broad VFS redesign.

ADR-0072 explicitly recorded the old empty-on-preload-failure behavior. A change
to that clause needs DEC-2's short superseding correction naming precisely the
read-failure behavior; pairing/cache/write-through/other decisions remain. The
executed artifact now supplies baseline evidence; do not call the source issue
merely hypothetical or silently drop it from I6's prerequisite.

Bounded alternative if chosen deliberately: retain/export through strict fresh
reads of the EXISTING private `WorkbenchOwnerStorageAuthority.opfs.persistedVfs`,
then write only through OwnerVfsAuthority and verify the target via persisted
read-back before source cleanup. That is a read capability inside the same
catalog owner, not a second recovery owner. It must protect export after reopen
as well as initial copy; otherwise later preload failure can still yield a lossy
download. In-memory backend uses its actual Memory VFS. Never patch globals,
mask failures, bypass claim ingress, or trust a clean write ledger as read proof.

## Minimal catalog-owned route

Detect only the declared Scratch orphan: catalog has no Scratch reference and
its normal derived Scratch container/tree exists, after normal catalog and legacy
journal recovery/validation. A corrupt or unresolved journal is a loud failure,
not evidence that the tree is unjournaled. Do not steal a journal-owned stage,
pending legacy source or ordinary named project. A malformed container kind stays
preserved/loud; do not invent runnable metadata to fit it.

Current createScratch (`playground-project-authority.ts:2117-2161`) picks `create`
when stored.scratch is null; its precondition at:915-933 rejects the existing
physical target. The existing owner FIFO (:1830) and runCatalogMutation (:1888)
already own mutation, compact stages, unique transactionId, pointer proof and
crash recovery. Reuse those, with one finite retention role and derived paths.

Recommended minimal sequencing:
1. Retention-only catalog transaction: copy/prove ordinary orphan payload into a
   distinct derived retained root while original Scratch stays intact. Commit a
   stable retention record through the SAME catalog pointer/transactionId. Only
   then retire/clean the original Scratch container through existing claim/tree
   authority. This resembles convert-scratch's existing copy-before-pointer and
   source-cleanup-after-pointer flow, without its definition/trust rebind.
2. Ordinary createScratch transaction creates the requested fresh definition.
   If fresh creation fails after retention committed, report that failure and
   keep the already-retained bytes/list entry. No combined all-or-nothing promise
   was requested. This avoids a second coordinator and unnecessary whole-tree
   before/after JSON images. Record this sequencing explicitly in the I6 ADR.

Before retention pointer: failure rejects with original payload intact and no
false retained-success record; clean only a target the journal proves belongs to
this attempt. After pointer: retained bytes/record are authoritative; source cleanup
can retry/recover and must not roll back the completed preservation. Startup must
finish a committed retention cleanup before detecting another orphan, preventing
repeat retention of the same leftover source. Never GC unknown retained roots
merely because an index entry is absent; that would recreate the loss problem.

Retained roots belong outside normal projects/scratch replacement and
`CATALOG_TRANSACTIONS_ROOT` GC (currently removed wholesale at:1621-1628).
Example spelling only: `/.rifty/workbench/playground/retained-scratch/<id>/tree`.
A stable opaque id is validated with existing finite-id rules; derive paths from
it rather than storing caller paths in the journal. Old catalogs default the new
optional retained-record collection to empty. Do not place retention into the
runnable projects list, attach starter/definition identity to unproven bytes, or
mint target install trust (ADR-0261/0329).

Public minimum: two semantic methods on the EXISTING catalog surface:

```ts
listRetainedScratch(): Promise<readonly { readonly id: string }[]>
exportRetainedScratch(id: string): Promise<string> // bounded recovery download
```

Names/record decoration remain candidate choices. Automatic retain is private;
no public retain/force-trust/raw path, owner handle, import/adopt or delete endpoint
is necessary. Listing/export must work while the fresh session is live and when
fresh creation failed; they cannot depend on forSession().archive. They are
non-consuming reads over the current namespace and existing owner lifetime/FIFO.
A timeout/closed owner/read failure leaves records/bytes available for retry.
Existing catalog transport can carry finite id/result commands; no new channel.
An alternative adds retained records to catalog snapshot/subscribe and just one
export method, but widens the exact public catalog frame. Either is agent-owned;
no user question is justified merely by this packaging choice.

## Archive representation and actual existing limits

A second executable probe used REAL MemoryFs and existing archive functions:

```sh
node --import tsx /tmp/rifty-316-orphan-preload-probe/archive-probe.mts
```

Exit0; `archive-result.json` / `archive.log` show:
- public export keeps `.git`, `.vite`, ordinary nested `.rifty` and source bytes;
  it omits node_modules/dist and private root `.rifty`;
- generic buildWorkspaceArchive({exclude:[],includeDirectories:true}) keeps
  dependency/build bytes and empty directories, still omits install claims;
  it also includes private root `.rifty` and exposes its physical root `/orphan`;
- ordinary public import rejects root-private/derived paths; generic ingress
  rejects install-claim paths; a finite export limit rejects loudly.

Thus neither existing export function can be exposed unchanged for I6. The
public codec loses required bytes; the generic one lacks the public bounded/
root-private contract. Do NOT relax normal editable-workspace import merely to
make recovery export importable. A recovery download is not a trusted snapshot.

Existing editable-workspace bounds (`internal/playground-archive.ts:20-27`,
ADR-0278 archive section), all still active:
- 48 Mi UTF-16 JSON code units;
- 20,000 traversal entries /10,000 files /256 path segments;
- 16 MiB decoded per file /32 MiB decoded total.

A small data-only recovery envelope can reuse bounded traversal, normalized paths,
canonical base64 and these finite constraints, with an explicit recovery path
policy permitting node_modules/dist and a distinct format tag/public root `/`.
Keep `.git`, `.vite`, ordinary nested `.rifty`; omit only genuine root-private
metadata and every install-claim namespace, including claim-shaped directories.
Preserve directory entries when the chosen carrier supports them; retention
itself already uses exact directory/file copies. Never fabricate missing file
bytes, silently truncate entries or substitute placeholder package.json.

The current snapshot tar encoder is NOT a generic raw backup encoder: its API
requires DepSnapshotV3 package/lock/replay metadata and emits a dedicated payload/
control envelope (ADR-0386). Reusing it with invented install identity/manifest
would violate Fidelity. A standard tar recovery download is viable only by
sharing/extracting the existing pure tar mechanics with its own truthful entry
contract/bounds; that is larger than a bounded JSON download, not required by I6.
I1's standard dependency-tar promise does not automatically prescribe I6 format.

Do not silently impose workspace-archive bounds on retention itself or claim
unlimited capacity. File-by-file retained storage is independent of constructing
one export string. Over-limit export must be explicit and non-consuming; quota
failure during preservation must leave the source. At pickup measure the actual
representative I6 payload and compile its finite export contract. Existing limits
from another API are not automatic authority to declare a required accepted
scenario complete if its bytes cannot be downloaded. No size-driven user fork is
established without that evidence; no new maximum-project-size guarantee is
invented here. The 128 MiB dependency-snapshot cap is likewise not a free higher
recovery budget.

## Proof to carry into pickup/Contract+RED

- Real unjournaled OPFS Scratch with no catalog/journal, ordinary binary bytes,
  node_modules, dist, Git/nested `.rifty`, and private claim-shaped entries.
  Preserve→fresh create→list/export→close/reopen: stable retained id, exact payload,
  unchanged unrelated files and namespace B/default roots; orphan never runnable.
- Retry/reopen after copy read/write/quota/permission failure: original source
  remains, no false record/fresh-success; include the executed preload and
  metadata+preload fault. Source-read honesty and durable target-read-back matter.
- Native kills before/after retained-copy proof, retention pointer, source cleanup,
  and fresh-Scratch creation pointer. Use existing OPFS catalog pointer fixtures;
  assert raw bytes after recreation, no duplicate retention or deletion of the
  only copy. Journal unresolved/corrupt is not an orphan detector shortcut.
- Post-retention fresh-create failure keeps the committed record/download;
  export failure, budget rejection and owner close do not consume it.
- Private claims remain excluded from download/ingress and never gain trust at
  retained or fresh roots; ordinary fresh materialization owns any new claim.
- Archive exact paths/topology/base64/entry and byte bounds; no quiet omission of
  build/dependency files, root redaction, retry after a transient failed read.

This document is research plus executed baseline probes, not an I6 verdict or
implementation permission. Parent owns the eventual route/ADR/contract and proof.

# I6 prerequisite — independent DEC-2 preload decision

2026-09-09. Read-only tracked tree, depth1/no children. Source around
1bf453c0ed35ee6dc1734384ab4c79a14f815a9c while parent prepares I4. No product,
tracked test, ADR, commit or full build changes. Native scratch probes completed;
no running processes.

## Decision

Approve a narrow partial supersession of ADR-0072's empty-on-missing-content
behavior BEFORE orphan retention uses the mirror. Choose the existing cache
state as authority: a cached Uint8Array, including length0, is real content;
a known file without an entry has unavailable content and synchronous read/copy
must fail loudly. One shared cache-read chokepoint serves readFileBytesSync and
copyFileSync. cpSync inherits it. No new failure ledger, global init rejection,
SAB worker, resolver, per-file epoch, public option or persistent metadata.

Use existing VfsError EIO for an indexed but uncached file, with its logical
path and an explanatory content-unavailable message. This reports a cache
availability failure, not a claim that a past native permission refusal is
still current. Preserve ENOENT/ENOTDIR/EISDIR and destination-validation order.
No source-size test can authorize the empty fallback.

Leave eager per-file preload, paired async surface, index discovery, backend
selection and async write-through/drain authority intact. Successful existing
preload or explicit write establishes cache bytes; unrelated cached files remain
usable. This decision does not promise cache/native coherence for live external
or paired-async changes, or turn a best-effort repeated preload into an atomic
refresh contract.

## Authority and supersession boundary

- Goal self-hosted-snapshot-workbench, scenario6/I6 and Decisions: retain ordinary
  orphan bytes for enumeration/download, fresh Scratch, no adoption/deletion of
  the only copy; failure stays visible and retryable. Draft
  playground/orphan-scratch-recovery.md adds ordinary dependency/build bytes,
  reopen persistence and non-consuming failed download.
- Raw-source authority available in repo: accepted goal decisions plus
  distribution/reference/embedder-gaps-evidence.md:61-68; the original orphan
  creation cause remains unestablished. Do not invent a private Tracker oracle.
- ADR0072 §Decision, readFileBytesSync bullet at line28, explicitly authorizes
  content.get(path) ?? new Uint8Array and calls transient boot-read failure a
  safe empty fallback. Supersede ONLY that fallback/assumption. The native
  evidence now disproves it. The same implicit permission in copyFileSync must
  go at the shared source owner, not be patched in each consumer.
- Source comments requiring matching correction: opfs-sync.ts:304-329 and
  :608-613 say failed preload reads empty until write. Replace the empty-success
  description with unavailable content/loud read. Do not graft unrelated ADR
  cleanup. ADR0072's write-through, paired structural interface, eager preload,
  sync cache authority, Worker lifecycle and backend-selector corrections stand.
- ADR0090's copy byte fidelity is satisfied by refusing unknown source bytes;
  retain its fail-fast/best-effort cp partial output, rename sync re-key,
  mtime, asynchronous persistence, and existing error ordering.
- ADR0358/0359 persist ledger/drain semantics stand. A failed preload is not a
  failed persist operation; do not add it to the write-failure ledger or redefine
  flush.total. Clean flush cannot attest that source bytes were ever acquired.
- I4/ADR0402 mount identity and paired/index root selection are independent;
  the same content state/guard works under the eventual selected root.

## Independently executed evidence

Original parent artifacts read:
/tmp/rifty-316-orphan-preload-probe/{run.mjs,worker.ts,result.json,run.log}.
They show native9 bytes, preload getFile failure, init success, empty sync read,
empty durable copy, clean flush; metadata+preload double failure also has stat0.

Independent widened native sweep executed (exit0):

`node /tmp/rifty-316-i6-preload-decision-probe/run.mjs`

Artifacts in that directory: run.mjs, worker.ts, bundled worker.js, result.json,
run.log. Node24.16.0, Chromium148.0.7778.96. Actual paired installOpfsFs,
Workers and OPFS; only native FileSystemFileHandle.getFile is fault-decorated.
Every case uses a fresh browser context/native store; original method restored
before independent durable observations. Original binary A is
[0,1,2,127,128,254,255,13,10]. Genuine empty file and healthy [11,22] are controls.

| Case | Actual current result |
|---|---|
| healthy baseline | cache A, empty[], healthy[11,22], native A |
| preload-only refusal | indexed size9, sync[], init succeeds |
| metadata+preload refusal | indexed size0, sync[], init succeeds |
| copy onto existing[77,88], either refusal | target becomes real durable[]; source A remains; flush0 |
| cp recursive after refused preload | source A remains; copied user.bin is real durable[]; flush0 |
| rename after refused preload, later native read allowed | durable destination A, old source removed AFTER write; sync destination[] both before/after flush; later copy produces durable[] |
| rename with continuing source-read refusal | original native A remains, moved user.bin absent, flush failures5; no source deletion |
| explicit preload retry after original fault clears | existing method establishes cache A again |

Empty[] and healthy[11,22] work in all cases. Thus global init failure is not
needed to distinguish unreadable source from unrelated healthy files. No size
heuristic works: the double fault and genuine empty both stat0, but only the
latter has actual cached bytes.

The first scratch launch failed only because the new /tmp directory lacked a
node_modules link; adding a link to this checkout fixed harness resolution.
That module-loader error is not product evidence.

## Exact birth and sibling sweep

All references packages/vfs/src/opfs-sync.ts unless noted:

1. walkOpfsTree:168-175 keeps an enumerated file with size0 when metadata getFile
   fails. This keeps it discoverable; it does not establish any content bytes.
   statSync:815-830 reads this metadata and performs no later native read,
   despite an old walk comment suggesting that an open/stat surfaces the error.
2. preloadContent:312-330 catches per-file native/paired read failure and leaves
   a new instance's content Map without that entry. No success bytes exist.
3. readFileBytesSync:601-613 turns that absence into [] — the first fabrication.
4. copyFileSync:982-1003 repeats the same fallback before writeFileSync — second
   reachable instance, requiring one chokepoint (Class-kill). Existing target
   validations must still run before this new source-content error; no target
   write is enqueued when the source is unavailable.
5. cpSync:1007-1037 delegates each file to copyFileSync. Preserve source, propagate
   the file failure, retain earlier completed destination entries (ADR0090).
   No new recursive rollback/preflight transaction is justified.
6. renameSync:1086-1097 re-keys only actual cached byte entries, otherwise carries
   fileMoves without bytes. persistRenameAsync:1151 reads actual paired source
   bytes on that miss, writes them, THEN removes source. Read failure reaches
   the existing persist ledger. Preserve this path and its existing test
   'renameSync persists uncached indexed files before removing the old subtree'
   at opfs-sync.test.ts:984. Do not make rename require warm content as a side
   effect of sharing the read/copy guard. After moving an unavailable cache
   entry, sync reads/copies of the new name must remain unavailable, never [].
   Do not opportunistically fill cache from an older async rename task: doing
   so could overwrite a newer authoritative sync write and would need a separate
   lifecycle decision.
7. writeFileSync:640 establishes real copied input; preload success:322 does
   likewise. Removal:470 deletes content. openSync/ensureHandle:387-410 indexes
   native files but does not fill content: an indexed-only read is unavailable,
   not implicit empty. Do not infer content from getSize()===0 or restore the
   obsolete handle-on-sync-hot-path implementation.
8. MemoryFsSync delegates actual backend bytes; no missing-content empty fallback
   found. Async OpfsVfs.readFile:92-105 reads native File bytes and rejects; no
   analogous empty success. Keep both implementations unchanged.
9. OwnerVfsAuthority.readFileBytesSync:204, copyFileSync:278, cpSync:286 and
   renameSync:313 forward these semantics. A failed underlying copy does not
   record successful target mutation. Catalog copyManagedTree/CopyDurably
   (:419,442) therefore inherit the fixed read/copy boundary. captureTree:88,
   owner snapshots/deltas (:522,737), archive export (:358-362), and
   no-coi-toolchain-worker.snapshotFiles:51-63 are read consumers of the same
   corrected chokepoint; they must never capture [] for unavailable content.

Root fault: false-fallback/provenance-lie at native Storage read -> sync content
availability -> consuming operation. `lossy-aggregate` is the size0/[] collision;
copy proves the downstream durable consequence. Native permission/read failures
are real at this boundary; no transport-loss or duplicate-message mechanism is
involved. No new queue/epoch/coordinator is needed for this state distinction.

## Additional requested probe — repeated preload with prior cached bytes

Same native harness has an eighth case, repeat-existing. It is sequential,
not a race:

1. Real initial preload establishes cache A.
2. Same actual paired async VFS overwrites native file with B=[9,8,7,6,5,4,3,2,1].
3. refreshIndex succeeds; direct paired native read proves B. Sync still reads A.
4. A new preloadContent read of this file is refused; preload resolves, sync
   still reads A; copy persists A elsewhere with clean flush.
5. Successful subsequent preload changes sync content to B.

This is measured, not ruled out. It belongs to populated-cache/native freshness
and paired-surface coherence, an additional serialized manifestation alongside
vfs/opfs-sync-cross-realm-mirror-coherence. No foreign Worker is needed for this
specific path. refreshIndex's contract is index metadata; it does not refresh
content. ADR0072 makes content authoritative for sync users and describes
preload as boot best-effort, not a transactional live reload/rollback guarantee.
A was genuinely acquired and remains that sync mirror's value; unlike initial
absence, it is not fabricated content. The narrow fix MUST NOT be reported as
solving every failed refresh or synchronizing arbitrary paired/native writes.

Do not invalidate prior entries on all failed reads without a distinct
cache-authority decision: cache may contain not-yet-durable sync writes, so
blind deletion can discard the only current logical bytes. Clearing at preload
start also changes live-read availability and interaction with pending writes.
No epoch/CAS/ledger or live concurrent-preload redesign is authorized by the
initial orphan cold-cache failure. Keep this measured limitation linked to the
existing coherence finding; parent may record the added serialized path there.
I6's startup orphan retention has no prior authoritative cached incarnation:
its byte-availability prerequisite is still satisfied by the presence guard.
If later I6 code uses repeat preload as proof of current native bytes, that would
need an explicit stronger contract or direct persisted read-back, not this guard.

## Alternatives assessed

A. Existing cache-presence read/copy guard — CHOSEN. Two root fallbacks disappear
behind one small owner helper; genuine zero-length entries work. No cache schema,
failed-path collection, global readiness or write-ledger semantics change.

A2. Store the original preload error in a typed existing cache entry — possible,
but not required for byte retention. It widens read/write/rename cache handling
and demands lifetime rules for old errors. EIO reporting unavailable bytes is
already an honest outcome; preserving the historical error code is not a new
I6 API requirement. Do not introduce a separate error Map by default.

B. Catalog-only strict persisted reads — technically capable of protecting a
new preservation path, but reject as the prerequisite repair. It leaves the
observed generic read/copy fault and its inherited consumers alive, and adds an
async copy/export side route where the existing source owner can fix it once.
The actual existing private capability is WorkbenchOwnerStorageAuthority.opfs.
persistedVfs; native source/target read-back remains useful I6 acceptance proof.
If ever deliberately chosen as an extra integrity check, it must be inside the
same catalog mutation owner, preserve pending mirror/write semantics, and cover
post-reopen export too. It is not permission for another recovery coordinator.

C. Reject all init on any preload read failure — rejected. It broadens a per-file
problem into a global backend/owner bootstrap failure; current storage policy may
fall back to memory. Healthy and real-empty native controls prove no such global
barrier is necessary. It would change more ADR0072 boot/pairing policy than the
required source-availability repair.

D. Sync native read-through/SAB worker or rename-only/catalog-only patch — rejected.
The former revives the larger mechanism ADR0072 already rejected; asynchronous
native handle acquisition cannot satisfy an arbitrary synchronous read. The
latter leaves the physically demonstrated read/copy twins inconsistent.

## Tests/records intentionally expecting empty

- Explicit old authority is ADR0072:28 plus opfs-sync preload/read comments.
- Repo search found no opfs-sync/sync-mirror test explicitly asserting empty
  content after failed preload. Existing tests mostly populate content through
  writeFileSync. Do not quietly rewrite healthy zero-byte cases or generic
  ENOENT/EISDIR/size/mtime tests to fit the guard.
- opfs-sync.test.ts:984 explicitly expects uncached rename's real async persisted
  copy before removal. It must stay GREEN; it does not assert readable cache.
- terminal/reference/review-2026-06-07.md already called cold-cache copy empty
  bytes a defect, not desired behavior.
- vfs/opfs-preload-failure-empty-bytes.md currently calls the observation static/
  unmeasured. Parent should replace that status with these executed native facts,
  link it as the required I6 prerequisite, and delete/rechart only when repaired
  and proven. Lazy-preload performance work remains separate.

## Required RED / proof carrier for parent

Before source edit, promote native real-pair fault tests based on these probes:

- healthy binary and actual empty file load/copy normally;
- one failed byte preload and metadata+byte double failure: init/index remains,
  reads throw for that path, unrelated cached/empty files work, original native
  source unchanged;
- copy to missing and existing nonempty destination rejects without a target
  persist; old target bytes remain, source remains;
- cp with lexically earlier healthy child then unavailable child fails and
  preserves source plus allowed earlier output, never an empty failed child;
- renamed unavailable file: existing durable async move succeeds from true
  native bytes, new-name sync read/copy refuses while uncached; continuing async
  read refusal keeps source and existing failure ledger behavior;
- successful existing preload retry or explicit real write establishes content
  and restores reads/copy, including explicit zero bytes;
- owner/catalog/backup consumption does not publish an empty successful copy or
  source image. Native read-back is the oracle, not same-cache hashes/size or
  clean flush. Carry full retention/source-cleanup crash proof in I6 feature,
  not as a new sync-copy transaction guarantee here.

Use current browser-unit/native Worker fixture conventions, real paired VFS and
native handle rejection only. Unit VFS read/copy dispatch/error-order tests can
supplement; do not mock the paired VFS sibling or unit under test. Revert-check
both shared-reader ingress call sites, then relevant VFS + owner/copy/export
regressions and independent Final+GREEN. No package compatibility or unrelated
index/durability policy needs supersession to ship this narrow repair.
