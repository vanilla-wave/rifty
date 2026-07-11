---
area: playground
status: draft
title: Explicit template-vs-user-edit provenance — see my edits, revert/reset to the template baseline
created: 2026-06-17
why: a user edits a template but nothing tracks WHICH changes are theirs vs the template's; no per-file "revert to template", no workspace "reset", no dirty indicator — seed/switch/reload retention is implicit and surprising
user_story: As a playground user, I want to take a template, edit it, SEE which files are my changes vs the template baseline, and revert a file (or reset the whole workspace) back to the template, but today provenance is implicit (seed-if-absent + program mirror + vfs-write into one owner tree), there is no baseline to diff against, and the only restore is a full workspace-archive import.
sources: [ADR-0078, ADR-0079, ADR-0135, ADR-0148, ADR-0165]
code: [packages/workbench/src/workers/real-vite-bootstrap.ts, apps/playground/src/App.tsx, packages/workbench/src/glue/workspace-archive-port.ts, packages/workbench/src/glue/install-stamp.ts, apps/playground/src/templates]
---

## Context

> Update 2026-06-21 (ADR-0165): the WHOLE-workspace reset + the baseline mechanism are now decided and folded into multi-project management — baseline = the Starter bundle re-derived from the registry by `starter` id (no stored per-project baseline), reset = one-shot whole-workspace re-seed, and the switch-vs-reload "drops edits" surprise is replaced by the explicit dirty-scratch confirm dialog. What REMAINS open here is the PROVENANCE half: live-vs-baseline diff, the explorer "modified" badge, and PER-FILE revert — split out to `per-file-revert-to-starter`. Keep this item for the provenance/per-file work; the reset/baseline bullets below are superseded by ADR-0165.

The playground has no explicit model of "user edits vs template baseline." What exists is implicit:
- the owner seeds template files IF-ABSENT (`real-vite-bootstrap` `seedProject`/`bootDevServer`) and the page pushes the program mirror + preset files (`App.tsx` `seedWorkspaceOwner`); user edits flow over `vfs-write` into the SAME owner tree — once written, a user file is indistinguishable from a template file;
- a preset SWITCH resets `package.json`/node_modules/lockfile to the new template, while a RELOAD preserves the user tree — correct, but invisible to the user (no warning that a switch drops edits);
- the only save/restore is a FULL workspace-archive export/import (`workspace-archive-port`) — no baseline, no diff, no per-file revert;
- `install-stamp` tracks dep identity, not source-file provenance.

So a user cannot: see which files are THEIR edits, revert one file to the template, reset the whole workspace to the template, or understand why a switch dropped their changes but a reload kept them.

## Options or Next

- Keep an immutable per-workspace TEMPLATE BASELINE of the seeded source tree (pre-edit) to diff/reset against. (The baked dep-snapshot already covers node_modules; this is the SOURCE baseline.)
- Derive provenance by diffing live vs baseline (added/modified/deleted) → a "modified" badge in the explorer/editor + a workspace "N edits" indicator.
- Per-file "Revert to template" + workspace "Reset to template" (write baseline bytes back over the owner tree via the existing vfs-write/owner path).
- Make the switch-vs-reload retention rule explicit in the UI (confirm on switch when the user has edits).
- Genuine design fork: where the baseline lives (owner is the single store → likely an owner-held read-only baseline tree) and its persistence (OPFS) — its own ADR when taken.

Related but distinct: `distribution/create-rifty-template` (scaffolding a host), `baked-snapshot-regeneration` (dep snapshot), `preset-switch-port-flip-window`.

## Reversibility

REVERSIBLE to scope/sequence as a backlog item. The baseline-store location + persistence model (owner-held baseline, OPFS) is a genuine design choice → its own ADR when taken (touches the single-store-owner topology). No public API change.
