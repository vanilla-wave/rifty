# ADR 0165: Multi-project management with durable scratch

Status: Accepted
Date: 2026-06
Corrected: 2026-06-29

> TL;DR: Two user entities over the single owner — **Starter** (=today's `Preset`, immutable gallery bundle) and **Project** (named, autosaved, in OPFS) — plus one unnamed **Scratch** draft. On-disk: `/scratch` + `/projects/<id>/` + a project index. Exactly one active root/dev-server. **Switching tears down and respawns the owner** with a new `RIFTY_RFV_ROOT` (the env is spawn-time-only — there is no live re-point). Save CONVERTS scratch→project (tree move, index-pointer flipped last). Reset re-seeds scratch from its Starter bundle (baseline = the registry definition, re-derived, not stored). `ProjectSpec` stays internal plumbing.

## Context

Selecting a preset OVERWRITES the single `/workspace` tree → user work is lost (`App.tsx` `WORKSPACE='/workspace'`, line 48). Goal: run many projects in one tab — pick a Starter, work in an unnamed scratch, save it to a named project, switch/rename/reset/delete, and see where it persists (OPFS vs memory). Design fixed in a `/grill-me` session + a high-fidelity UI handoff (launcher-tab placement, terminal-luxe theme). This ADR records the IRREVERSIBLE half: the domain entities, the on-disk layout, the switch mechanism, and the install-stamp/baseline consequences.

Load-bearing code constraints (verified, not assumed):
- The owner is spawned ONCE (`App.tsx:218 startWorkspaceOwner`); ADR-0146/0148 warn against a second/transient owner.
- `RIFTY_RFV_ROOT` is read ONCE at owner bootstrap (`real-vite-bootstrap.ts:408`) into a frozen `cfg.root` (line 427) that keys `serveNodeModulesReads`/`serveWorkspaceArchive`/`publishVfsSnapshot` + `setProcessCwd`. `setDevConfig`/`onDevConfig` (line 357) deliberately re-resolve the dev spec against `cfg.root` WITHOUT changing it; owner `writeFile` even throws `Reload to respawn the owner` post-exit. **There is no live root re-point path.**
- `install-stamp` reuse key is the **slug** (`install-stamp.ts:137`); ADR-0135 set `slug = preset.id`. On-disk stamp path is already root-relative (`installStampPath(root)`), so disk isolation per root is free — only the KEY and the `devServer.boot` templateId-keyed cleanup trigger (`real-vite-bootstrap.ts:197`) are wrong for multi-project.
- COI is hard-asserted synchronously before module init (`vfs/boot.ts:108`); a non-isolated host throws fatally and never reaches the UI. `detectVfsBackend()` → `memory` only on the isolated-but-OPFS-unsupported / `persistedAfter===false` path. `BootResult` is captured once, never re-probed.

## Decision

1. **Two user entities + internal runtime (corrected 2026-06-29).** **Starter** = today's `Preset` (immutable bundle: id/label/category/icon/glyph+color/setup/templateId/files[]/openFiles[] + baked snapshot) — the user-facing gallery item. `files[]` is the complete ordinary file bundle for editor-openable preset content and MUST include the template entry path; `openFiles[]` is only the initial tab order. **Project** = `{id, name, starter, editedAt}`, named, autosaved, in OPFS. **Scratch** = `{starter, dirty, editedAt} | null`, at most one, the current unnamed draft. `ProjectSpec` (vite / node-server) stays INTERNAL plumbing, not a UI entity; only `templateId` crosses the realm boundary (env), each realm re-resolves via `resolveProjectSpec` (throws on unknown — ADR-0078, no silent fallback).

2. **On-disk OPFS layout** evolves from single `/workspace` to: `/scratch/<tree>` (active unnamed draft) + `/projects/<id>/<tree>` (named) + a **project index** file (`[{id,name,starter,editedAt}]` + `scratch` pointer + `activeId`). The active root is derived state `rootForId(activeId)` = `/scratch` or `/projects/<id>/`. The `WORKSPACE='/workspace'` constant is DELETED.

3. **Switch = owner teardown + respawn (NOT live re-point).** Real mechanism, strictly sequential to keep exactly one owner: dirty-confirm → save-or-discard → set `activeId` → `workspaceOwner.close()` → AWAIT worker exit → `startWorkspaceOwner({ root: newRoot, template, setup, slug })` → AWAIT ready → re-wire ALL page bridges (snapshot/nm/archive subscriptions bind to the NEW owner) → restart dev server → clear terminal. NO new owner spawns before the old one exits (two concurrent owners on the singleton `syncMirror` OPFS backend = emnapi pthread crash). The spec's "reuse `RIFTY_RFV_ROOT`" holds only as "the env var stays the root parameter" — it is re-baked per spawn. Matches the design intent ("switching = restarting the preview").

4. **Dynamic root threading.** `rootForId(activeId)` replaces the `WORKSPACE` constant at every page surface: `presetBootLines`, editor `workspaceOwner.writeFile`, `FileExplorer`, archive/snapshot/nm bridge subscriptions, `restartDevServer`, `runVitePreset`. `resolveBootstrapConfig`/`presetBootLines` already take `root` — the page just stops passing the constant. Missing one surface = edits/seeds land in the wrong project with no error → covered by RED tests.

5. **Install-stamp key becomes project-scoped** (evolves ADR-0135 §4 clause): `slug = projectId` (or `'scratch'`), not `template.id`. Two projects from the same Starter share `templateId` but MUST NOT share `node_modules` (slug-only key would reuse project-A's tree for project-B → wrong deps / `EBROKENLOCK`). The `devServer.boot` cleanup (`real-vite-bootstrap.ts:197`) must fire on **root/projectId change**, not only `templateId` change. Baked snapshots stay **template-keyed** (a shared Starter artifact, restored into each per-project root with `replace:true`). node_modules stays in-place per project, no purge on switch (local disk + baked snapshots are rifty's edge-cache equivalent); disk growth → quota/GC backlog.

6. **Baseline = the Starter bundle, re-derived (not stored).** The immutable baseline for reset is the built-in Starter's registry definition, looked up by `starter` id — NO extra per-project OPFS artifact, survives reload, can't drift. Tracked conceptually only for the active scratch. **Reset** = one-shot WHOLE-workspace re-seed from that bundle (equivalent to re-picking the Starter), NOT a continuous diff and NOT auto-promote (both rejected in session). Per-file revert needs source provenance → backlog (`per-file-revert-to-starter`, extends `template-edit-provenance-reset`). The same bundle artifact later serves "export project as Starter" (M13).

7. **Save = CONVERT, atomic-safe.** Scratch → named project is a tree MOVE (`/scratch` → `/projects/<newid>/`), scratch=null, push to index, `activeId=newId`. OPFS has no cross-dir atomic rename in the sync mirror, so ordering is **copy → flip index pointer LAST → delete source**, with a boot-time recovery check for a half-move (a `/projects/<id>/` present but un-indexed, or a `scratch` pointer to a moved tree, is reconciled, never silently lost). Named projects **autosave** (no Save button, no dirty state, subtle toast); cadence → backlog (`autosave-throttle-policy`). Name-on-save = dialog, default = Starter's project name, `+N` on collision.

8. **Degradation is honest-loud, two distinct gates.** COI hard-assert is UNCHANGED (a non-isolated host can't boot the owner at all — not representable in-app). The degraded path is ONLY `detectVfsBackend()==='memory'` / `persistedAfter===false` (isolated, OPFS unsupported): show a degraded banner (above status bar, only when launcher closed + not dismissed) + status-bar `EPHEMERAL` badge + `Memory · session only` chip; Save still works in-session but EVERY save affordance is marked ephemeral (fidelity — never render a memory save identically to a durable one). Storage state is wired to the REAL `BootResult`/`detectVfsBackend`, never the prototype's manual `opfs↔memory` toggle (demo-only; a real manual flip would be a lie).

9. **One gallery (ADR-0079 preserved).** The launcher's **Starters tab IS the gallery**; the top-bar project-switcher **chip** is a launcher trigger, not a second disclosure. e2e contracts (`data-action='view-templates'`, `data-testid='gallery'`, `data-preset` rows) move with the gallery into the launcher and stay intact; the chip must NOT register as a second gallery switcher. Export/import logic stays LIVE in the owner (ADR-0146) for M13 reuse; only the launcher row-menu + status-bar Export SURFACES render disabled with a `soon` pill.

10. **Migration.** A user with an existing warmed single-era `/workspace` adopts it as the initial scratch on first multi-project load (no silent data loss). Edge cases (orphan vs default project) → backlog (`workspace-to-scratch-migration`).

11. **Scope boundary → M13.** User-authored starters / save-as-starter, share-by-link, importing external projects, and the Export-archive UI are OUT (kept visible-disabled). ROADMAP gains an M13 stub.

Rejected:
- **Live `RIFTY_RFV_ROOT` re-point via `setDevConfig`** — `cfg.root` is frozen at spawn and keys every bridge; a `setDevConfig` "switch" silently keeps writing the old root. No live-respawn path exists (`writeFile` throws post-exit). Teardown+respawn is the only faithful mechanism.
- **Spawning the new owner before the old exits** — two owners on the singleton OPFS `syncMirror` → pthread crash class. Switch is strictly sequential.
- **slug = `template.id` for multi-project** (ADR-0135's value) — cross-contaminates node_modules between same-Starter projects.
- **Continuous template↔live diff / auto-promote baseline** — rejected in the design session; baseline is a one-shot re-derivable bundle, reset is whole-workspace.
- **Copy-not-move Save** — design decided CONVERT (the scratch becomes the project); a copy would leave a phantom scratch.
- **Wiring the prototype's manual storage toggle to a real flip** — `BootResult` is a one-time probe; a manual `opfs↔memory` flip would pretend persistence we don't have.
- **Per-file revert now** — needs source provenance (separate from this layout decision) → backlog.

## Consequences

- Every switch RESTARTS the owner + terminal + dev server (env is spawn-time-only). Latency + e2e-timeout risk → backlog (`owner-respawn-switch-latency`); preview port flip during respawn → existing `preset-switch-port-flip-window` + new `per-project-persistent-port`.
- Per-project in-place node_modules grows OPFS unbounded (many projects × trees) → backlog (`project-node-modules-quota-gc`, deferred to M11 quota/GC).
- A half-completed Save is recoverable at boot (copy-then-flip-then-delete + reconcile), not corrupting — at the cost of a transient duplicate tree on disk during the move.
- Delete-with-Undo must DEFER the on-disk `/projects/<id>/` removal until the toast expires (or tombstone), else Undo restores an index entry pointing at deleted files.
- Dirty tracking binds to REAL owner file-write signals (`onFileWritten`), not the prototype's UI counters — terminal/file-tree edits set scratch dirty, so the discard-confirm gate can't lie.
- Memory-degraded mode persists nothing to OPFS; the `EPHEMERAL` marking on every save affordance is the honest signal (fidelity rule).
- ADR-0135 §4 (slug = preset id) is corrected here to project-scoped; ADR-0079 (single gallery) and ADR-0146/0148 (single owner, co-resident dev server — now respawned per switch) hold. `template-edit-provenance-reset` is folded: whole-workspace reset lands here, per-file revert stays open.
