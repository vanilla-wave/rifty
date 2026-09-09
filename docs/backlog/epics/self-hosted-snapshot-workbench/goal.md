---
kind: epic
status: ready
title: Self-hosted Workbench from published assets and dependency snapshots
created: 2026-09-07
value: An existing app bakes its Node dependency snapshot in its own CI and runs edit/build/preview from self-hosted published assets without a browser registry or interference with the host's storage and routes.
user_story: As the Tracker plugin-sandbox embedder, I want CI-produced standard file archives and copyable runtime assets to run a real Vite project inside my app, but today baking requires a rifty checkout and deployment reaches shared origin storage and root preview routes.
tier: production
---

## Outcome

Deliver the selected embedder gaps 3, 6, 7, 4, 8, 5, 10 plus a standard browsable tar.gz snapshot format.
A host supplies project files and a compatible dependency snapshot produced from
its package.json and npm lockfile, edits the project, runs the installed Vite
build/dev commands, and renders the real output. Snapshot application has two
explicit modes: apply the supplied snapshot, or initial deployment only
(default), after which saved state takes priority. The host needs published
packages and static serving, without a rifty checkout, custom worker bundling,
or a browser-side npm registry. This is M11 consumer adoption of the existing
Node runtime, not new package compatibility.

Storage and preview paths are host-selected. Existing projects stay available
through their former storage setting. An unjournaled orphan Scratch cannot
force the host to edit OPFS internals: its bytes remain downloadable while a
fresh Scratch becomes usable. Relevant operation budgets are host-configurable.

## User scenario

1. The existing Tracker plugin project uses package.json + package-lock.json;
   its CI uses the published producer and a registry endpoint requiring no
   builder-owned authentication to bake a tar.gz
   dependency snapshot browsable by a standard archive tool and obtain snapshotId plus install-artifact identity.
2. The host copies published Worker/SW/WASM assets and the snapshot to its own
   static paths, supplies documented headers and URLs, and selects snapshot-only.
3. It opens a fresh storage namespace and a page under /sandbox/ with preview
   under that same SW scope. Unrelated host pages/files remain outside rifty's
   managed routes/storage. The user edits and builds the real Vite project;
   dev preview and its assets/HMR resolve under the configured prefix.
4. First deployment uses the supplied snapshot. Later opens default to saved
   state: a newly supplied snapshot never silently replaces an edited project.
   If saved state is incompatible, startup fails with a reason while preserving
   all files; the host can explicitly choose snapshot application. When a
   snapshot is actually needed/applied, invalid input fails before startup,
   without registry fallback. Existing registry-enabled acquisition remains.
   The host can explicitly choose apply-snapshot mode, independent of prior
   snapshotId, with conflict policy overwrite or error. Conflict is about file
   paths/types/bytes, not package identity or dependency interpretation. Error
   leaves the complete prior state intact; overwrite replaces conflicting
   targets, adds absent entries and leaves unrelated saved paths intact.
5. Selecting a new OPFS root starts empty. Returning to the former setting
   reopens the former projects; no automatic migration or deletion occurs.
6. If Scratch bytes exist without a catalog reference or recovery journal, the
   host receives a fresh Scratch and can enumerate/download the retained old
   bytes through public API, including after reopening.
7. The host raises the budgets governing slow boot, file commit/durability, and
   Playground catalog/SCM/archive requests without patching package dist. A
   timeout retains the current honest applied/unknown/failure distinction.

The private Tracker source is not available in this repo. Acceptance uses a
public Vite project through the same manifest/lock/definition APIs and real
package tarballs, not invented private-package fixtures; private-package
compatibility is not claimed. No new latency or maximum-project-size promise.

## Invariants

Baseline: main 333224fe46f22fe9c974429a81fbc4b7d0cc63f8. Evidence and
per-invariant absence: docs/backlog/distribution/reference/embedder-gaps-evidence.md.
Each statement below is false on that baseline; gzip decoding alone is already true.

1. I1. Published producer accepts caller manifest + npm lockfile and configured
   registry, emits a compatible tar.gz and machine-readable identities;
   a packed consumer restores it through public API without a rifty checkout.
   Ordinary tools list/extract real file entries. Control metadata/cache live
   outside the project payload namespace, so no admitted user path can collide
   with them or be renamed/reserved just to fit the snapshot format.
2. I2. Copying the published runtime asset closure suffices to boot Workbench
   and run the real project; the consumer compiles no Worker/SW entries and
   writes no builtin-alias or QuickJS bootstrap wrapper.
3. I3. Public snapshot-only acquisition needs no registry URL and makes zero
   registry/Eddy requests; unavailable, corrupt, or incompatible snapshots fail
   loudly before guest startup when the selected application policy requires
   that snapshot. A valid saved project is not blocked by an unused new asset. Missing dependency bytes never trigger network
   installation through terminal/package APIs in this mode.
4. I4. A selected OPFS namespace bounds rifty's normal preload and writes;
   unrelated origin files are untouched. A new namespace starts empty and
   former projects remain accessible with the former storage setting.
5. I5. A host-selected preview prefix within a non-root SW scope supports real
   iframe navigation, asset loading and HMR without requiring root scope or
   changing the project's source URLs just to accommodate embedding.
6. I6. Unjournaled orphan Scratch bytes are retained byte-exactly and exposed
   for public enumeration/download while a fresh Scratch opens; retained bytes
   survive reopen. Failed preservation never deletes or replaces the only copy.
7. I7. Public configuration controls the effective budgets for owner startup/
   storage proof, project-file commit/durability, and catalog/SCM/archive
   requests; raising a budget is not defeated by a hidden shorter sibling
   deadline. Defaults and mutation-settlement semantics remain explicit.
8. I8. Snapshot application exposes initial-deployment-only and apply-snapshot
   modes. Initial-deployment-only is default: an existing project's saved files
   take priority, including when the supplied snapshotId changes. Incompatible
   saved state fails startup without changing bytes and permits an explicit
   host update decision; it is never silently reseeded or reinstalled.
   Apply mode evaluates the supplied payload even when snapshotId is unchanged.
   It exposes overwrite/error conflict policies, default error: identical
   files and compatible directory entries are not conflicts; different bytes
   or incompatible entry types/ancestors are. Error reports conflicting paths
   with zero payload changes. Overwrite replaces conflicting targets and adds
   missing entries; saved paths outside those targets remain. No policy branch
   depends on a file being package.json, a lockfile or a dependency file.

## Decisions

- 2026-09-07 — pre-run re-fit after scope audit; rounds 2/3 decisions below supersede the earlier open-fork status, whose history stays in the ledger.
- 2026-09-07 — F1 resolved by user: a registry without builder-owned authentication is sufficient; the embedding environment owns access to a private registry.
- 2026-09-07 — F2 resolved by user: explicit apply-snapshot vs initial-deployment-only modes; default initial-deployment-only gives saved state priority, preserves bytes and stops on incompatibility pending an explicit choice (I8).
- 2026-09-07 — user-origin I8 changes the baseline automatic Scratch reseed on snapshot identity drift; pre-run re-fit, not an implementation decision.
- 2026-09-07 — F3/F4 resolved by user: file conflicts control application; expose overwrite/error, with no dependency/package-specific distinction.
- 2026-09-07 — error is default under the user's round-2 preserve-before-explicit-update choice; conflict preflight leaves all prior bytes intact, overwrite is explicit.
- 2026-09-07 — apply evaluates payload regardless of previous snapshotId; absence from the payload is not a deletion request, except descendants of an explicitly replaced incompatible target.

- 2026-09-07 — user selected feedback 3, 6, 7, 4, 8, 5, 10 and gzip; other feedback is not added.
- 2026-09-07 — user: a new storage root starts empty; old projects stay accessible under the previous setting; no migration.
- 2026-09-07 — user: open fresh Scratch and retain orphan bytes for public download, rather than adopting the orphan as a runnable project.
- 2026-09-07 — user: producer-generated ordinary tar.gz with metadata; accepting arbitrary local node_modules archives is outside this goal.
- 2026-09-07 — user: rifty-specific archive files/directories cannot collide with user contents; enforce disjoint envelope namespaces, not a supposedly unique filename in the user tree.
- 2026-09-07 — compatibility: retain the existing v3 JSON/gzip reader; new producer emits tar.gz. Container choice does not bypass identity, replay integrity or byte-cap checks.
- 2026-09-07 — production tier: new persistent namespace/recovery transitions require crash/reload proof; no claim of protection against browser eviction.
- 2026-09-07 — COI Workbench scope follows the report; no-COI SDK, React bindings and a new IDE UI are separate.
- 2026-09-07 — package names, API spellings, asset layout and recovery carrier remain implementation choices; public boundary decisions require ADRs at pickup.
- rejected route: special package.json/dependency conflict policy or skipping apply merely because snapshotId is unchanged — violates I8.
- rejected route: automatically replace saved state after changing the supplied snapshot in default mode — violates I8.
- rejected route: require a rifty checkout for baking — violates I1.
- rejected route: consumer builds Worker/SW entries from a recipe — violates I2.
- rejected route: fake registry URL or automatic install on snapshot rejection — violates I3.
- rejected route: automatically migrate old storage into a newly selected root — violates I4.
- rejected route: delete orphan Scratch or silently run its unproven tree — violates I6 and the user recovery decision.

- rejected route: JSON compressed with gzip, or metadata inserted under a reserved user filename — violates I1.

## Challenge

challenge: 2026-09-07 — clear

### Re-fit — application and registry policies

challenge: 2026-09-07 — clear
