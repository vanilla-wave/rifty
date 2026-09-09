# I4 storage namespace pickup — source research

Read-only DEC-4/DEC-2 research around HEAD2005f2a5d8e4dcf088f13bf49c435ce9622a85c1.
I3 work is concurrent; recheck line numbers at pickup. No behavioral probes,
tests, tracked changes, or implementation. This is evidence/route advice, not
Contract+RED or a new accepted contract.

## Accepted destination

- Goal I4 and scenario5: selected OPFS namespace bounds normal preload/writes;
  a previously absent selection starts empty; returning to the former setting
  exposes former projects. No migration or deletion. Existing directory contents
  are preserved on every reopen; "new namespace" never means clearing a folder.
- Goal I6/scenario6: unjournaled Scratch bytes retained for public enumeration/
  download while fresh Scratch becomes usable; retention survives reopen;
  preservation failure cannot delete/replace the only copy.
- Existing defaults remain. Storage addressing is not a hostile-code boundary,
  general guest-network isolation, or permission for concurrent Workbenches.
- Namespace spelling/layout/API are agent-owned per goal Decisions. No new
  observable user fork found; do not re-ask the already selected empty-new-root/
  old-setting/no-migration behavior.

## Minimal authority

Mount ONE selected FileSystemDirectoryHandle as logical `/` for BOTH OpfsVfs and
OpfsFsSync. Existing logical paths, package caches, claims, catalog/stages and
legacy paths then inherit the boundary without prefix wrappers or rewritten
project identities. Physical namespace must not enter project-definition identity,
install-stamp format, catalog ids, replay-cache paths, or guest paths.

Current gap:
- `vfs/sync-mirror.ts:143-152` constructs OpfsVfs.init(), then independently calls
  OpfsFsSync.init(vfs). Each currently acquires origin root.
- `vfs/opfs.ts:51-59` stores origin root in its private handle; subsequent file,
  directory, stat, stream, remove operations descend from that handle.
- `vfs/opfs-sync.ts:289-301` independently acquires origin root; refreshIndex
  (`:340`) walks that whole root and preloadContent (`:312`) reads every indexed
  file through the paired async surface. Its persistDirectoryPath/resolveParent
  (`:346-371`) also descend from the stored root.

Recommended route: a root-handle input at the EXISTING pair installation seam,
not a new backend or state owner. For example, preserve no-argument behavior and
add `installOpfsFs(root?: FileSystemDirectoryHandle)` internally; allow the existing
OpfsVfs.init / OpfsFsSync.init to consume that same selected handle. Exact
signatures are pickup choices. Reuse Sync.init's index+preload sequence rather
than copying it into a second boot initializer. Select/validate namespace before
installing either surface, and publish the pair through setSyncMirror only after
both initialize. Keep direct no-arg VFS callers and initBackend unchanged.

Resolve the selected directory once in the Workbench owner storage composition
(or the pair installer from a validated descriptor). Do not let each backend
independently resolve a name: one wrong default would index one tree and preload/
persist another. Keep Worker/sync-capability checks before new-directory creation.

Rejected alternatives:
- Prefix only catalog/project constants: OpfsFsSync still scans the origin;
  tarball cache and proof files remain outside the prefix — violates I4.
- Prefix/route every filesystem operation through a new wrapper: duplicates
  addressing, rename/copy, persistence and error rules; unnecessary with native
  root handles (REV-7).
- Clear a selected namespace on boot or migrate default contents into it:
  violates explicit scenario5 and endangers I6's only orphan copy.

## Minimal public shape and validation

Suggested additive API (not yet adopted):

```ts
storage: {
  persistence: 'required' | 'preferred' | 'ephemeral';
  namespace?: string; // one literal OPFS directory component
}
```

Absent namespace means EXACT historical origin-root mount. Explicit namespace
means origin/<namespace>, with logical `/` inside it. A single opaque component
is sufficient for I4 and avoids unnecessary nested-root alias/creation policy.
Do not derive it from projectId, sessionStorage workspaceId, URL pathname or a
random owner epoch. Do not expose a raw directory handle through Workbench.

Validate the whole input before page claim, Web Lock, SW registration, Worker or
OPFS effects. Reject non-string/empty or whitespace-only value, NUL, `/`, `\\`,
`.` and `..`; do not trim or normalize distinct host selections into one another.
A namespace is a literal filesystem name, not a URL: no percent-decoding. Keep
`.crswap` treatment consistent with the OPFS backend; its FILE reservation is
source-described in `opfs-errors.ts:64-91`, not an excuse for an unrelated namespace
registry. A restricted documented ASCII token is another bounded naming choice,
but don't silently claim arbitrary filesystem-path support.

If nested relative paths are chosen instead, validate ALL components before
creating any; reject empty/dot/dot-dot/absolute/ambiguous components. Do not use
normalizePath to silently collapse `a/../b` or select origin root. This is extra
path policy, not required by the accepted scenario.

Syntactically invalid config always rejects, including under preferred/ephemeral.
A valid selection whose live entry is a file, denied, or fails quota is an OPFS
open failure: never overwrite that entry. Preserve required rejection and
preferred's visible memory fallback unless a later contract explicitly changes
that existing policy. Ephemeral stays memory-only and must not create an OPFS
namespace; it may carry the validated option inertly.

Input propagation must cover:
- `workbench/internal/workbench-options.ts:51,58,128,191`: normalized storage
  currently collapses to the persistence string. Carry one validated object.
- `open-workbench.ts:197-202`: currently reconstructs `{persistence}`; forward
  the whole normalized storage selection.
- `workbench-owner-port.ts:90`, `owner-protocol.ts:65,260-270,312`: update the
  exact clone-safe shape and validate the same namespace spelling at wire ingress.
- `workbench-browser-owner.ts:555` already forwards input.storage.
- `workers/workbench-owner-runtime.ts:272` currently passes only persistence;
  provide selection to workbench-owner-storage's default installer closure.
- PlaygroundWorkbenchOptions derives WorkbenchOptions (`playground.ts:341`),
  so it should inherit the same field, not create a companion-only duplicate.

No public snapshot field, live namespace setter, new project API, or stamp format
is required by I4. Existing owner-reported backend/durability/fallback remains
truth. Close/reopen with different options changes namespace; a running owner's
mount never changes. If namespace is additionally exposed in snapshot(), have
that value come from the owner, not a page prediction (ADR-0372).

## Side-path inventory

| Path | Scope effect / required preservation |
|---|---|
| owner storage proof | `workbench-owner-storage.ts:8,86-138`: logical `/.rifty/workbench/v1/storage-proof/<nonce>`; sync write+flush, paired persisted read, nonce cleanup+flush must all land inside the SAME namespace |
| owner VFS/revisions | runtime `:274-279` wraps syncMirror and indexes initial roots `/` and `/.rifty`; once backing mirror is scoped, its revision inventory is scoped too |
| package state/cache/claims | all use that authority/SyncMirrorVfs; `/.rifty/tarball-cache` and root-bound `.rifty-install-stamp.json` need no physical prefix or new claim owner |
| core project store | `workers/workbench-project-store.ts:71-80` derives existing logical project containers/tree/definition paths; do not re-key |
| companion catalog | `playground-project-authority.ts:58-66`: `/.rifty/workbench/v1/{projects,stages}` and `/.rifty/workbench/playground/{catalog,transaction,migration-journal,...}` all inherit mounted root |
| catalog recovery/cleanup | startup at `:1733`; orphan transaction stage cleanup `:1621-1628` deletes only fixed derived catalog-transactions root; empty-parent cleanup must remain within scoped VFS |
| legacy adoption | browser composition `:22-27,92-96` captures legacy prefix from sessionStorage; wire `owner-protocol.ts:291-300` validates `/workspaces/<token>`; catalog `:1773-1810` reads it THROUGH mounted authority. In a new namespace it must not reach the origin's old legacy tree or seed itself from it |
| Node/dev-server/TS children | sealed child entries use owner RPC, not installOpfsFs/initBackend; changing owner mount bounds ordinary child file operations without each child selecting a root |
| direct generic VFS users | initBackend/no-arg installOpfsFs keep historical defaults; no-COI SDK behavior remains outside this Workbench unit |
| first-party App terminal history | `apps/playground/src/glue/terminal-persistence.ts:45-49` creates its OWN origin-root OpfsVfs; App main.tsx:55 injects it separately. This host-owned App facility is not shipped inside Workbench. Keep default App behavior; if App is switched to a namespace in this unit/proof, separately thread its store or do not claim its whole-page OPFS is confined |

Production search over packages + apps/playground found direct navigator storage
root acquisition only in the two VFS backends. The extra App terminal store
reaches origin indirectly via OpfsVfs. Browser native test fixtures also access
origin directly: their verification paths must deliberately use physical
namespace prefixes, never accidentally inspect old default paths.

## Keep the origin-wide lease

`open-workbench.ts:630` still requests exclusive `rifty:workbench:v1`, plus the
same-page claim at159-175. Acquisition precedes SW registration/owner boot
(:189); project close retains the lease, Workbench close releases it only after
owner teardown (:534-579). Crash release is ADR-0263's existing Web Lock contract;
ADR-0293 gives contention its public error.

Retain this exact global lease, even for two different namespaces. Namespace-keyed
locks would silently permit concurrent Workbenches, contradicting ADR-0263 and
the goal map's explicit exclusion; current SW/preview and App side paths also
remain shared. No new lock owner or namespace registry. To return to old setting:
close current Workbench (including physical owner/drain teardown), then open
with the former namespace or omit it for historical origin root. The old durable
catalog and claims are still at their original physical addresses.

## Failure, cleanup and proof plan for pickup

No new recovery journal is needed merely to create/open a directory. A failed
boot may leave an empty selected directory or selected proof residue; never
recursively delete the selected physical root as compensation. Existing contents
may predate this attempt, and timed-out browser writes can settle late. All such
writes remain confined by the captured handle; preserve current proof cleanup,
owner shutdown and per-path drain/fence semantics (ADR-0358).

Required executed carriers still to prepare:
1. Public root + companion accept optional namespace; malformed selection fails
   before claims/locks/SW/Worker effects; wire rejects malformed/extra branch data.
2. Real Chromium OPFS: unrelated origin sentinel + old default project; open A,
   prove neither outside path is indexed/preloaded into owner, write project/cache/
   claim/proof data, flush/close; B starts fresh; reopen A restores exact bytes;
   omit namespace restores old default project. Unrelated sentinel remains exact.
3. Prove BOTH async persisted read and sync preload/write use selected handle;
   a wrapper that redirects writes only must fail. Preserve absolute guest-path
   behavior and same-owner sync/async coherence.
4. Existing selected dir is never cleared; entry-file conflict/permission/quota/
   proof-read/cleanup failure preserves other namespaces and visible policy result.
   Test invalid config under preferred does not masquerade as memory fallback.
5. Cross-page A/B contention still rejects before second Worker; sequential close/
   reopen succeeds. Use existing real `workbench-web-lock.spec.ts` rather than
   asserting only a source lock string.
6. Kill/reload at relevant new namespace boot/proof and existing catalog commit
   boundaries; old namespace/sentinel survive, pending claims/journal semantics
   remain honest. Reuse `workbench-snapshot-application.spec.ts` native pointer
   interception and OPFS drain/kill fixtures, with explicit physical prefixes.

Existing carriers to retain: `owner-publish-and-persistence.spec.ts:45` (sealed
required OPFS reopen), `workbench-web-lock.spec.ts` (real contention/release),
`workbench-owner-storage.test.ts:29-98` (policy/read-back/cleanup/fallback criteria),
`owner-storage.test.ts`, VFS OPFS/conformance suites, ADR-0372 no-COI backend tests,
ADR-0279 catalog transaction recovery and ADR-0358 drain faults. Their existence
is source evidence here, not a claim this task reran them. Fake installer unit
seams cannot close new namespace browser acceptance.

## I6 composition, not a second recovery owner

A selected namespace exposes its own orphan at logical
`/.rifty/workbench/v1/projects/scratch/tree`; namespace mounting must not hide,
clear, or auto-adopt it. Current empty-catalog startup preserves ordinary project
containers; later create conflicts when the target already exists. Existing
`cleanupOrphanCatalogTransactionStages` is GC for transaction stages, NOT authority
to delete or adopt an unjournaled Scratch.

I6 should add finite retention/enumeration/export semantics to the existing catalog
owner/FIFO and transaction/pointer recovery. Retained records need stable opaque
ids and live in the mounted namespace, outside normal scratch replacement and
transaction-stage GC. Public methods must work without making the orphan a live
ProjectSession: current `forSession().archive` cannot serve that role. Minimal
surface later is catalog-owned list + non-consuming export by retained id (exact
spellings/carrier belong to I6 ADR); no raw filesystem path, owner port, namespace
handle, force-trust, delete/eviction API or new retention coordinator is necessary.
Downloads must retain ordinary bytes/relative paths and existing claim-ingress
restrictions; transfer never fabricates restored trust. Current PlaygroundArchiveV1
is files-only (`playground.ts:287`); do not infer unpromised empty-directory support
or use that shape as proof before choosing the actual I6 export carrier.

Important source-derived I6 proof risk: `OpfsFsSync.preloadContent():312-330`
swallows per-file read errors, leaving a known file uncached; readFileBytesSync (`:601-613`) then returns an empty Uint8Array. Thus warm mirror bytes alone are not proof
that an orphan was preserved exactly before deleting its only durable source.
`WorkbenchOwnerStorageAuthority.opfs.persistedVfs` already retains the actual
paired read-back surface. I6 needs a discriminating unreadable/failed-preservation
RED and an honest read/preservation proof through existing authorities; do not
turn this source observation into an untested I4-wide preload rewrite or a new
recovery owner. No runtime failure was executed in this research.

## ADR disposition

Add a short namespace/mount ADR citing 0263, 0072, 0372, 0358 and 0279. The additive
opt-in addressing decision keeps old defaults, storage-policy outcomes, pairing,
lease and transaction authorities; no standing decision needs superseding.
I6 later adds a separate short catalog retention/API decision citing 0279/0263
and the namespace ADR. A proposal to namespace the lease, change default root,
clear/migrate existing data or replace the recovery authority would overturn
accepted decisions and is not part of this route.
