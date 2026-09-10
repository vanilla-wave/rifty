---
area: playground
status: draft
title: Keep Scratch dirty policy within the IDE companion
created: 2026-09-10
why: project VFS and npm command handling currently classify changes according to Scratch dirty semantics
user_story: As a Workbench integrator, I want filesystem and command behavior independent of IDE Scratch state, while the Playground still accounts for edits from the editor, terminal and Git.
sources: [docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/adr/playground/0307-install-trust-is-an-install-protocol-commit-not-tree-surveillance.md, docs/backlog/playground/reference/project-open-ide-boundaries-refine.md, docs/backlog/playground/scratch-reset-keeps-page-dirty.md]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

`workbench-project-vfs` excludes writes inside node_modules specifically for
Scratch dirty. `owner-package-state` recognizes first clean dependency arrival
and reports package-manifest/package-lock mutations to the companion. These
callbacks cross generic filesystem/package handling and await catalog reflection.
The Scratch boolean itself is in the Playground catalog, not the base VFS API.

User direction: «dirty черновика как будто фича про ide и не должна протекать
в другие уровни». Own its meaning in the IDE companion; lower layers provide
filesystem/operation facts without deciding whether a Scratch is unsaved.

## Boundaries

- Preserve current user-visible classification: editor/guest/Git/import edits
  count; starter seed, initial dependency arrival and extraneous install-tree
  writes retain their existing exclusions. No new meaning of dirty is selected.
- Include off-editor writes and preserve their existing close/reload outcomes;
  a page-only editor listener cannot replace the current behavior.
- A companion module may live in the owner Worker. Domain ownership does not
  imply moving durable state to the page or adding another state owner.
- The proven page reconciliation gap remains `scratch-reset-keeps-page-dirty`;
  fixing that gap alone does not establish this ownership boundary, and the
  boundary proposal does not claim that Reset has been fixed.

## Decisions

- 2026-09-10 — pickup: behavior-preserving ownership follows existing baseline (RDY-8); observed page reconciliation uses its executed RED; ADR-0414 adds the owner boundary.

- 2026-09-10 — user direction is ownership, not a redefinition of edits; existing ADR-0278/0307 semantics remain the baseline.
- 2026-09-10 — reuse existing mutation/publication facilities where sufficient; carrier, public API consequences and any required ADR stay with pickup.

## Challenge

challenge: 2026-09-10 — clear; baseline-preserving ownership; ADR-0414 records independent alternatives.

2026-09-10 — fresh read-only `/root/review_open_boundary`:

> Перенос смысла dirty в IDE оправдан. Но IDE должна учитывать факты guest/npm/Git writes; «IDE владеет» не означает «наблюдаем только editor» или «владелец обязательно живёт на странице».

Source and dispositions: `reference/project-open-ide-boundaries-refine.md`.
No new listener, journal, lock or coordination mechanism is selected here.

## Pickup notes

The original wrap-up's nine-kind taxonomy, no-op `dependency`, unused producer
kinds and transit `treeRevision` are cleanup candidates within this ownership
work, not new user choices. Validate current consumers first; preserve the
separate VFS revision/publication contract and baseline clean/dirty semantics.
Disposition of the full report: `reference/fs-dirty-stamp-findings-disposition.md`.

## User scenario

Edit Scratch through the editor, terminal, npm, Git and import, then close/reopen
or Reset. The same meaningful edits remain dirty and the same generated/seed
changes remain clean; lower filesystem/npm layers report facts without choosing
IDE dirty state. An authoritative Reset clears the page's UNSAVED/discard guard.

## Acceptance

1. Companion owns install-tree exclusions, first generated dependency arrival and manifest/lock dirty classification. Generic VFS/npm report operation facts; no new dirty owner or journal. → scenario
2. Preserve editor/guest/npm/SCM/import dirty state, initial seed/dependency and extraneous node_modules exclusions, same-starter preservation and durable catalog settlement on close/reload. → scenario
3. Authoritative Scratch Reset clean publication clears page UNSAVED and discard guard while a genuinely pending starter transition retains its existing protection. → scenario

## Fault matrix

- sibling-drift × editor/guest/npm/SCM/import | one companion policy retains current classifications | owner-package-state, workbench-project-vfs, playground-project-catalog and companion browser suites → scenario
- observable-order × reset/catalog publication | authoritative clean replaces prior dirty; pending starter protection remains | page-store-reset.contract.test.ts + real companion Reset → scenario
- quota-perm-fail × catalog reflection | existing mutation settlement reports failure rather than false durable dirty | playground-project-catalog contract fault cases → scenario

## Out of scope

New dirty meaning, editor-only observation, new synchronization framework and
latency work. Existing unsupported operations retain loud failures.
