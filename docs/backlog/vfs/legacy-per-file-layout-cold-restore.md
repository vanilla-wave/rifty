---
area: vfs
status: draft
title: Legacy per-file OPFS namespace — one-time notice, playground honesty, and reclaim after the format switch
created: 2026-09-01
why: slice A moves the workbench store to a new versioned namespace so the per-file layout is never read again; nothing yet tells the user that projects persisted before the switch were not carried over, and their bytes stay in OPFS uncounted
user_story: As a developer reopening the playground after the format switch, I want to be told once that projects saved under the previous storage layout are gone and why, but today the catalog would simply be empty and the old bytes would sit in OPFS with no explanation.
epic: fast-project-open-reopen
blocked_by: [vfs/segmented-opfs-replica]
sources: [docs/adr/playground/0165-multi-project-management-with-durable-scratch.md, docs/adr/playground/0286-workspace-archives-round-trip-observable-git-and-nested-dot-rifty-state.md, docs/backlog/vfs/storage-pressure-and-eviction-ux.md]
code: [packages/workbench/src/workbench/project-materialization.ts, packages/workbench/src/workbench/workbench-project-store.ts, packages/workbench/src/workbench/health.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

Goal invariant I3 (`epics/fast-project-open-reopen`), user-facing half.
The mechanism is NOT here: slice A (`vfs/segmented-opfs-replica`) bumps the
already-versioned store namespace (`workbench-project-store.ts` `ROOT =
'/.rifty/workbench/v1'`, `StoredCatalog.version: 1`) to `v2`, so a per-file
tree is never read as state, and the existing open path
(`project-materialization.ts` `open()`: store record absent → stage
`definition.files` → promote) re-materializes the project from its
definition with zero new authority. `project-deps.ts` (stamp / snapshot /
install, ADR-0135) then owns `node_modules` only. `v1` bytes are left
untouched — never read, never deleted by this goal — so the switch destroys
nothing by itself; quota accounting of the dead namespace belongs to
`vfs/storage-pressure-and-eviction-ux`.

What this item owns beyond the trigger:

1. One-time notice: when `/.rifty/workbench/v1` exists and `v2` is being
   created for the first time, the workbench emits a health issue through the
   existing `WorkbenchHealthIssue` channel with a NEW scope value (`kind:
   'degraded'`, scope `storage-layout`): "projects saved under the previous
   storage layout were not carried over; their bytes remain until storage is
   cleared". `fatal-invariant` (session over, `recovery: 'reload'` re-hits the
   same tree) and `persistence` (`Workspace persistence failed` + retry) are
   rejected as carriers — both would lie about what happened.
2. Playground honesty: with the namespace bump the v1 catalog is invisible,
   so the playground starts with an empty catalog — it never rebuilds a
   starter under an old project name (which `planFor` → `presetForId` would
   do if only the tree vanished). The notice above is the only surface; no
   export-before-switch prompt (user, 2026-09-01) — export after the switch is
   impossible by construction, and that is accepted.
3. Loss statement, sized honestly: for every named project and scratch, all
   of: edited source files, `npm install` results, `git clone`d repositories
   (no definition source — `git clone` is not a project origin), `.git`
   history. Affected population unknown (pre-1.0 playground, no telemetry).
   A bounded reuse route exists — the ADR-0165 §10 migration journal
   (`playground-project-authority.ts` `copy | promote | mark |
   source-cleanup`, fault-tested) could read v1 once through the still-live
   per-file reader — and was NOT taken: user decision 2026-09-01, breaking
   change. The format ADR (slice A) records the no-migration decision as an
   IRREVERSIBLE clause so the rationale outlives the goal directory.

Fault rows (production tier): v2 materialization fails after staging (quota
/ crash / owner death) → v1 untouched, v2 absent, next open retries the
same stage/promote (`project-materialization.ts` is already crash-safe:
stage → promote); notice emitted but page killed before it renders →
re-emitted on the next open while v1 exists and the catalog was empty (no
"seen" marker — the condition is re-derived); cross-tab writer — struck:
`WorkbenchOriginOccupiedError` (origin Web Lock) excludes it; quota
exhaustion by the dead v1 namespace → visible through the storage estimate,
owned by `vfs/storage-pressure-and-eviction-ux`. Acceptance carrier: a
browser-unit spec seeding a v1 per-file project + catalog, opening on the
new build, asserting empty catalog + the `storage-layout` issue + v1 bytes
still present; a reload e2e killing the page between stage and promote.

## Challenge

challenge: 2026-09-01 — 10 problems
- [BLOCKING: cheaper direct authority] The draft's own premise — "the gap is the trigger, the re-materialization path exists" — is satisfied by authorities already on main, so the separate contract buys almost nothing: `project-materialization.ts` `open()` re-materializes exactly when the store record is absent (`existing === null` → `beginStage` → `writeStageFile(definition.files)` → `promoteStage`), and `workbench-project-store.ts` already exposes `deleteProject`/`discardStage`; the workbench namespace is already version-segmented (`workbench-project-store.ts:8` `const ROOT = '/.rifty/workbench/v1'`, same constant in `playground-project-authority.ts:30`, and `StoredCatalog` carries `readonly version: 1`). Either bumping that segment or deleting the record inside slice A's already-contracted "loud refusal of a legacy per-file layout (layout marker)" reaches I3's second half with no new refusal surface, no new fault rows, and — for the namespace route — leaves the legacy bytes recoverable instead of destroyed, which is strictly safer than "discards it". Close by naming what this item owns beyond the trigger (the playground-catalog half), or by a recorded override.
- [advisory] The cited re-materialization owner is the wrong one: `project-deps.ts`'s header defines it as "Dependency arrival for a real-project boot (ADR-0135), in priority order: 1. **stamp** … 2. **snapshot** … 3. **install**" — `node_modules` only; the project *source* tree comes from `definition.files` via `project-materialization.ts`. "re-materializes from the project definition through the existing `project-deps.ts` provenance path (snapshot / install, ADR-0135)" therefore names a path that cannot restore a single user file, and `code:` repeats the mis-attribution.
- [advisory] The playground outcome is not "loud loss" but a plausible-looking lie: `planFor` rebuilds every project from `presetForId(starterId)` (`apps/playground/src/adapters/playground-app.tsx:155`), so the user reopens "my-api" and gets an intact-looking starter with all work gone, while every surface the draft admits ("both derive from existing surfaces (`fatal-invariant`, `persistence` health events; ADR-0165 degraded banner), never a new channel") is global and transient — `WorkbenchHealthIssue` carries one free-text `summary` plus a fixed `recovery` enum (`health.ts`), nothing per project, nothing durable. A happy-path result that lies is what CLAUDE.md Fidelity forbids.
- [advisory] The two named surfaces have opposite semantics and the draft treats the choice as cosmetic: `fatal-invariant` routes to `healthAuthority.invariant.fatal` → `disposition: 'fatal'`, `recovery: 'reload'` (`health.ts:18-21`, `playground-workbench.ts:161`), i.e. session over and reload re-hits the same tree; the persistence path emits only `summary: 'Workspace persistence failed'` + a `recover` retry (`playground-workbench.ts:171`), which would label an obsolete-but-intact layout a persistence failure. "never a new channel" pushes toward one of two dishonest reuses.
- [advisory] "git clone" as a definition kind contradicts the goal it serves: Outcome (f) says reopen uses "local storage alone, as today — never a registry, eddy, or snapshot fetch on the reopen path" and `## Decisions` records "rejected route: network re-derivation of an installed tree on reopen". `git clone` is real (`packages/shell/src/commands/git.ts:2739`) and its bytes have no definition source, so the only honest answer for it is loss — listing it among sources implies a route the goal forbids.
- [advisory] The user-visible impact is never sized and is scoped in the wrong direction: the draft treats loss as the corner case ("playground catalog entry with no source → loud loss") while `StoredProject`/`StoredScratch` require `starterId` (`playground-project-authority.ts`), so a definition nearly always resolves and the *universal* loss is everything not in the starter — every edited file in every named project and scratch, every `npm install` result, every cloned repo — for a catalog that is live and wired (`runtime.catalog.subscribe`, `playground-app.tsx:745`). No count of affected projects/users, no statement that the loss is total per project.
- [advisory] The named mitigation is unreachable at the moment it is needed: "the pre-existing ADR-0286 archive is the user's own route" combined with "no export-before-switch prompt" means export (`exportArchive`, "Download workspace archive", `playground-app.tsx:1124`/`1308`) only helps a user who happened to export *before* upgrading; after the discard there is nothing left to export, and ADR-0286's own Context is written on the premise that "the archive can be the only backup".
- [advisory] "No migration reader for the old layout is written" never weighs the crash-safe legacy-layout adoption the repo already owns: `playground-project-authority.ts` holds `MIGRATION_JOURNAL_FILE`, `LEGACY_INDEX_NAME = '.rifty-project-index.json'`, `MigrationPhase` `copy|promote|mark|source-cleanup` and a `pending-adoption` state, fault-tested by `playground-legacy-catalog-migration.fault.test.ts`, on ADR-0165 §10's precedent "adopts it as the initial scratch on first multi-project load (no silent data loss)". Reading the legacy tree once through the still-live per-file reader into that stage/promote path is bounded reuse, not new machinery — if the recorded override was taken on "a migration reader is new machinery", its cost input was wrong (not tagged blocking: goal `## Decisions` records "Migration = cold restore (user, 2026-09-01)").
- [advisory] Fault rows are short of the inherited `tier: production` ("robust + crash/reload consistency + e2e fault proof"): `fault-classes.md` Storage row lists "quota/permission mid-op" and there is no row for quota exhaustion after the legacy tree is discarded but before `definition.files` is promoted (user ends with neither tree); cross-tab writers are excluded by `WorkbenchOriginOccupiedError` but §Boundary failure models requires the row be cited and struck, not omitted; owner/port death mid-rebuild ("peer death / port close = total inflight loss") is uncovered by the page-crash row; and no e2e carrier is named.
- [advisory] The rationale for destroying user data lives only in a directory scheduled for deletion: the draft defers to "User decision 2026-09-01 (goal `## Decisions`)", while README §Goal run closes a goal by "then delete the directory whole" — a breaking, data-destroying behavior change is IRREVERSIBLE under CLAUDE.md routing (genuine design choice / observable public behavior) and needs a clause in slice A's format ADR, else the reason disappears at CLOSE.

Disposition (2026-09-01): blocking problem taken — the namespace bump is
the carrier (slice A), v1 bytes untouched; this item now owns only the
notice, playground honesty, and the loss statement. Advisory 2 (owner
corrected), 3–4 (new health scope; fatal/persistence rejected), 5 (`git
clone` = loss), 6 (loss sized as total per project), 7 (accepted, stated),
9 (rows added, e2e carrier named), 10 (ADR clause) answered above.
Advisory 8: the bounded migration-reuse route is recorded for the user's
final say in the FIT report; the breaking-change decision stands until they
reverse it.
